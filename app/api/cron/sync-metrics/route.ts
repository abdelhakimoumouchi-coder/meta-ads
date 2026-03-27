import { NextResponse } from 'next/server';
import { z } from 'zod';
import { syncCampaign } from '../../../../lib/sync/sync-campaign';
import { syncAdSets } from '../../../../lib/sync/sync-adsets';
import { syncAds } from '../../../../lib/sync/sync-ads';
import { syncMetrics } from '../../../../lib/sync/sync-metrics';
import { createSyncRun, findCampaignByMetaId, listCampaigns } from '../../../../lib/db/queries';
import { META_CAMPAIGN_ID } from '../../../../lib/meta/config';
import { cronLogger as logger } from '../../../../lib/logs/logger';

export const dynamic = 'force-dynamic';

// ─── Validation schema ────────────────────────────────────────────────────────

const SyncMetricsBodySchema = z.object({
  campaignMetaId: z.string().min(1).optional(),
}).optional();

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

  const startedAt = Date.now();

  // Parse and validate request body.
  let requestCampaignId: string | null = null;
  try {
    const rawBody = await req.json();
    const parsed = SyncMetricsBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 },
      );
    }
    if (parsed.data?.campaignMetaId) {
      requestCampaignId = parsed.data.campaignMetaId;
    }
  } catch {
    // Empty body is fine.
  }

  const targetMetaId = requestCampaignId ?? (META_CAMPAIGN_ID || null);

  // If no Meta campaign ID is configured, we can only sync metrics for campaigns
  // already present in the DB (no fresh Meta API fetch for campaign/adsets/ads).
  if (!targetMetaId) {
    const existing = await listCampaigns();
    if (existing.length === 0) {
      await logger.warn('sync-metrics skipped: no META_CAMPAIGN_ID configured and no campaigns in DB', {});
      return NextResponse.json({
        ok: false,
        status: 'SKIPPED',
        skipReason: 'NO_CAMPAIGNS',
        message: 'Set META_CAMPAIGN_ID env or pass campaignMetaId in request body.',
      });
    }

    // Sync metrics for all campaigns already in DB, passing the campaign's own metaId.
    await logger.info('sync-metrics: syncing metrics for all DB campaigns (no META_CAMPAIGN_ID)', {
      campaignCount: existing.length,
    });

    let totalUpserted = 0;
    let totalSkipped = 0;
    let failedCampaigns = 0;

    for (const campaign of existing) {
      const campaignStart = Date.now();
      try {
        const metricsResult = await syncMetrics(campaign.metaId);
        totalUpserted += metricsResult.upsertedCount;
        totalSkipped += metricsResult.skippedCount;
        await createSyncRun({
          campaignId: campaign.id,
          success: true,
          errorMessage: null,
          durationMs: Date.now() - campaignStart,
        });
      } catch (err) {
        failedCampaigns++;
        const message = err instanceof Error ? err.message : String(err);
        await createSyncRun({
          campaignId: campaign.id,
          success: false,
          errorMessage: message,
          durationMs: Date.now() - campaignStart,
        }).catch(() => undefined);
      }
    }

    let status: string;
    if (failedCampaigns === 0) {
      status = 'SUCCESS';
    } else if (failedCampaigns === existing.length) {
      status = 'FAILED';
    } else {
      status = 'PARTIAL_SUCCESS';
    }
    const durationMs = Date.now() - startedAt;

    await logger.info(`sync-metrics complete: ${status}`, {
      durationMs,
      campaignsProcessed: existing.length,
      failedCampaigns,
      totalUpserted,
      totalSkipped,
    });

    return NextResponse.json({
      ok: status !== 'FAILED',
      status,
      durationMs,
      campaignsProcessed: existing.length,
      failedCampaigns,
      metrics: { upsertedCount: totalUpserted, skippedCount: totalSkipped },
    }, { status: status === 'FAILED' ? 500 : 200 });
  }

  // Full sync for the target campaign (Meta API → DB).
  try {
    await logger.info('sync-metrics cron started', { campaignMetaId: targetMetaId });

    const campaignResult = await syncCampaign(targetMetaId);
    const adSetsResult = await syncAdSets(targetMetaId);
    const adsResult = await syncAds(targetMetaId);
    const metricsResult = await syncMetrics(targetMetaId);

    const durationMs = Date.now() - startedAt;

    // Truthfully report success vs partial failure.
    const hasPartialFailure =
      adSetsResult.skippedCount > 0 ||
      adsResult.skippedCount > 0 ||
      metricsResult.skippedCount > 0;

    const status = hasPartialFailure ? 'PARTIAL_SUCCESS' : 'SUCCESS';

    const campaign = await findCampaignByMetaId(targetMetaId);
    if (campaign) {
      await createSyncRun({
        campaignId: campaign.id,
        success: !hasPartialFailure,
        errorMessage: hasPartialFailure
          ? `Partial sync: adsets_skipped=${adSetsResult.skippedCount} ads_skipped=${adsResult.skippedCount} metrics_skipped=${metricsResult.skippedCount}`
          : null,
        durationMs,
      });
    }

    await logger.info(`sync-metrics cron complete: ${status}`, {
      durationMs,
      status,
      campaign: { metaId: campaignResult.campaign.metaId, wasCreated: campaignResult.wasCreated },
      adSets: { upsertedCount: adSetsResult.upsertedCount, skippedCount: adSetsResult.skippedCount },
      ads: { upsertedCount: adsResult.upsertedCount, skippedCount: adsResult.skippedCount },
      metrics: {
        adCount: metricsResult.adCount,
        upsertedCount: metricsResult.upsertedCount,
        skippedCount: metricsResult.skippedCount,
      },
    });

    return NextResponse.json({
      ok: true,
      status,
      durationMs,
      campaign: { id: campaignResult.campaign.metaId, wasCreated: campaignResult.wasCreated },
      adSets: { upsertedCount: adSetsResult.upsertedCount, skippedCount: adSetsResult.skippedCount },
      ads: { upsertedCount: adsResult.upsertedCount, skippedCount: adsResult.skippedCount },
      metrics: {
        adCount: metricsResult.adCount,
        upsertedCount: metricsResult.upsertedCount,
        skippedCount: metricsResult.skippedCount,
      },
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);

    await logger.error('sync-metrics cron FAILED', { error: message, durationMs, campaignMetaId: targetMetaId });

    const campaign = await findCampaignByMetaId(targetMetaId).catch(() => null);
    if (campaign) {
      await createSyncRun({
        campaignId: campaign.id,
        success: false,
        errorMessage: message,
        durationMs,
      }).catch(() => undefined);
    }

    return NextResponse.json({ ok: false, status: 'FAILED', error: message }, { status: 500 });
  }
}
