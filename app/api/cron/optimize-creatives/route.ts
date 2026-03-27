import { NextResponse } from 'next/server';
import { runOptimizer } from '../../../../lib/optimizer/decision-engine';
import { listCampaigns } from '../../../../lib/db/queries';
import { META_CAMPAIGN_ID } from '../../../../lib/meta/config';
import { IS_DRY_RUN } from '../../../../lib/constants/app';
import { cronLogger as logger } from '../../../../lib/logs/logger';

export const dynamic = 'force-dynamic';

// ─── Authorization guard ──────────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return token === secret;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  await logger.info('optimize-creatives cron started', { dryRun: IS_DRY_RUN });

  // Determine which campaign(s) to optimize.
  // 1. Accept optional campaignMetaId from request body.
  // 2. Fall back to META_CAMPAIGN_ID env.
  // 3. If neither is set, optimize all ACTIVE campaigns in DB.
  let requestCampaignId: string | null = null;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.campaignMetaId === 'string' && body.campaignMetaId.trim()) {
      requestCampaignId = body.campaignMetaId.trim();
    }
  } catch {
    // Empty body is fine.
  }

  const targetMetaId = requestCampaignId ?? (META_CAMPAIGN_ID || null);

  // Build the list of campaign meta IDs to process.
  let campaignMetaIds: string[];

  if (targetMetaId) {
    campaignMetaIds = [targetMetaId];
  } else {
    // All ACTIVE campaigns in DB.
    const dbCampaigns = await listCampaigns();
    campaignMetaIds = dbCampaigns
      .filter((c) => c.status === 'ACTIVE')
      .map((c) => c.metaId);

    if (campaignMetaIds.length === 0) {
      await logger.warn('optimize-creatives skipped: no target campaign and no ACTIVE campaigns in DB', {});
      return NextResponse.json({
        ok: true,
        status: 'SKIPPED',
        skipReason: 'NO_ACTIVE_CAMPAIGNS',
        message: 'No ACTIVE campaigns found in DB. Set META_CAMPAIGN_ID or pass campaignMetaId.',
      });
    }
  }

  const results: Array<{
    campaignMetaId: string;
    status: string;
    reallocated?: boolean;
    skipReason?: string | null;
    adCount?: number;
    error?: string;
  }> = [];

  for (const metaId of campaignMetaIds) {
    try {
      const decision = await runOptimizer({
        trigger: 'cron',
        campaignMetaId: metaId,
      });

      results.push({
        campaignMetaId: metaId,
        status: decision.reallocated ? 'REALLOCATED' : 'SKIPPED',
        reallocated: decision.reallocated,
        skipReason: decision.skipReason ?? null,
        adCount: decision.scores.length,
      });

      await logger.info('optimize-creatives: campaign processed', {
        campaignMetaId: metaId,
        reallocated: decision.reallocated,
        skipReason: decision.skipReason,
        adCount: decision.scores.length,
        dryRun: IS_DRY_RUN,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ campaignMetaId: metaId, status: 'FAILED', error: message });
      await logger.error('optimize-creatives: campaign FAILED', {
        campaignMetaId: metaId,
        error: message,
      });
    }
  }

  const failedCount = results.filter((r) => r.status === 'FAILED').length;
  let overallStatus: string;
  if (failedCount === 0) {
    overallStatus = 'SUCCESS';
  } else if (failedCount === results.length) {
    overallStatus = 'FAILED';
  } else {
    overallStatus = 'PARTIAL_SUCCESS';
  }

  await logger.info(`optimize-creatives cron complete: ${overallStatus}`, {
    campaignsProcessed: results.length,
    failedCount,
    dryRun: IS_DRY_RUN,
  });

  return NextResponse.json(
    {
      ok: overallStatus !== 'FAILED',
      status: overallStatus,
      dryRun: IS_DRY_RUN,
      campaignsProcessed: results.length,
      results,
    },
    { status: overallStatus === 'FAILED' ? 500 : 200 },
  );
}
