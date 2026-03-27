import { NextResponse } from 'next/server';
import { runBudgetGuard } from '../../../../lib/budget/safety';
import {
  findCampaignByMetaId,
  listAdsForCampaign,
  listAdSetsForCampaign,
  listCampaigns,
} from '../../../../lib/db/queries';
import { META_CAMPAIGN_ID } from '../../../../lib/meta/config';
import { IS_DRY_RUN } from '../../../../lib/constants/app';
import { centsToUsd } from '../../../../lib/utils/money';
import { cronLogger as logger } from '../../../../lib/logs/logger';
import { BASE_DAILY_BUDGET } from '../../../../lib/constants/app';
import type { AdBudgetAllocation } from '../../../../types/campaign';

export const dynamic = 'force-dynamic';

// ─── Authorization guard ──────────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return token === secret;
}

// ─── Per-campaign budget guard ────────────────────────────────────────────────

async function runGuardForCampaign(
  campaignMetaId: string,
  dryRun: boolean,
): Promise<{
  campaignMetaId: string;
  status: string;
  skipReason?: string;
  pacingState?: string;
  actionTaken?: string;
  notes?: string;
  error?: string;
}> {
  const campaign = await findCampaignByMetaId(campaignMetaId);
  if (!campaign) {
    return {
      campaignMetaId,
      status: 'SKIPPED',
      skipReason: 'CAMPAIGN_NOT_IN_DB',
    };
  }

  const [ads, adSets] = await Promise.all([
    listAdsForCampaign(campaign.id),
    listAdSetsForCampaign(campaign.id),
  ]);

  if (ads.length === 0) {
    return { campaignMetaId, status: 'SKIPPED', skipReason: 'NO_ADS' };
  }
  if (adSets.length === 0) {
    return { campaignMetaId, status: 'SKIPPED', skipReason: 'NO_ADSETS' };
  }

  const adSetMap = new Map(adSets.map((as) => [as.id, as]));
  const currentAllocations: AdBudgetAllocation[] = ads.map((ad) => {
    const adSet = adSetMap.get(ad.adSetId);
    const fallbackCents = Math.round((BASE_DAILY_BUDGET / Math.max(ads.length, 1)) * 100);
    const budgetCents = adSet?.dailyBudgetCents ?? fallbackCents;
    // Guard against absurd allocations: ensure each ad gets at least $1/day.
    const safeCents = Math.max(budgetCents, 100);
    return {
      adId: ad.metaId,
      adSetId: ad.adSetId,
      dailyBudgetUsd: centsToUsd(safeCents),
    };
  });

  // Validate total allocation is non-zero to avoid absurd guard decisions.
  const totalBudgetUsd = currentAllocations.reduce((s, a) => s + a.dailyBudgetUsd, 0);
  if (totalBudgetUsd === 0) {
    return { campaignMetaId, status: 'SKIPPED', skipReason: 'ZERO_BUDGET' };
  }

  if (dryRun) {
    return {
      campaignMetaId,
      status: 'SKIPPED',
      skipReason: 'DRY_RUN',
      notes: `[dry-run] Would run budget guard for campaign ${campaignMetaId} with ${ads.length} ads / ${adSets.length} ad sets`,
    };
  }

  const result = await runBudgetGuard({
    campaignId: campaignMetaId,
    campaignDbId: campaign.id,
    campaignStartDate: campaign.startDate ?? new Date(),
    currentAllocations,
  });

  return {
    campaignMetaId,
    status: 'SUCCESS',
    pacingState: result.pacingStatus.state,
    actionTaken: result.actionTaken,
    notes: result.notes,
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  await logger.info('budget-guard cron started', { dryRun: IS_DRY_RUN });

  // Determine which campaign(s) to guard.
  let requestCampaignId: string | null = null;
  let requestDryRun: boolean | undefined;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.campaignMetaId === 'string' && body.campaignMetaId.trim()) {
      requestCampaignId = body.campaignMetaId.trim();
    }
    if (typeof body.dryRun === 'boolean') requestDryRun = body.dryRun;
  } catch {
    // Empty body is fine.
  }

  // Global IS_DRY_RUN wins; request-level can only restrict to dry-run, not enable live mode.
  const effectiveDryRun = IS_DRY_RUN || (requestDryRun ?? false);

  const targetMetaId = requestCampaignId ?? (META_CAMPAIGN_ID || null);

  let campaignMetaIds: string[];

  if (targetMetaId) {
    campaignMetaIds = [targetMetaId];
  } else {
    const dbCampaigns = await listCampaigns();
    campaignMetaIds = dbCampaigns
      .filter((c) => c.status === 'ACTIVE')
      .map((c) => c.metaId);

    if (campaignMetaIds.length === 0) {
      await logger.warn('budget-guard skipped: no target campaign and no ACTIVE campaigns in DB', {});
      return NextResponse.json({
        ok: true,
        status: 'SKIPPED',
        skipReason: 'NO_ACTIVE_CAMPAIGNS',
        message: 'No ACTIVE campaigns found in DB. Set META_CAMPAIGN_ID or pass campaignMetaId.',
      });
    }
  }

  const results = await Promise.all(
    campaignMetaIds.map((id) => runGuardForCampaign(id, effectiveDryRun)),
  );

  const failedCount = results.filter((r) => r.status === 'FAILED' || r.error).length;
  let overallStatus: string;
  if (failedCount === 0) {
    overallStatus = 'SUCCESS';
  } else if (failedCount === results.length) {
    overallStatus = 'FAILED';
  } else {
    overallStatus = 'PARTIAL_SUCCESS';
  }

  await logger.info(`budget-guard cron complete: ${overallStatus}`, {
    campaignsProcessed: results.length,
    failedCount,
    dryRun: effectiveDryRun,
  });

  return NextResponse.json(
    {
      ok: overallStatus !== 'FAILED',
      status: overallStatus,
      dryRun: effectiveDryRun,
      campaignsProcessed: results.length,
      results,
    },
    { status: overallStatus === 'FAILED' ? 500 : 200 },
  );
}
