import { NextResponse } from 'next/server';
import { syncCampaign } from '../../../../lib/sync/sync-campaign';
import { syncAdSets } from '../../../../lib/sync/sync-adsets';
import { syncAds } from '../../../../lib/sync/sync-ads';
import { syncMetrics } from '../../../../lib/sync/sync-metrics';
import { createSyncRun, findCampaignByMetaId } from '../../../../lib/db/queries';
import { META_CAMPAIGN_ID } from '../../../../lib/meta/config';
import { cronLogger as logger } from '../../../../lib/logs/logger';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const startedAt = Date.now();

  try {
    await logger.info('sync-metrics cron started');

    const campaignResult = await syncCampaign();
    const adSetsResult = await syncAdSets();
    const adsResult = await syncAds();
    const metricsResult = await syncMetrics();

    const durationMs = Date.now() - startedAt;

    const campaign = await findCampaignByMetaId(META_CAMPAIGN_ID);
    if (campaign) {
      await createSyncRun({
        campaignId: campaign.id,
        success: true,
        errorMessage: null,
        durationMs,
      });
    }

    await logger.info('sync-metrics cron complete', {
      durationMs,
      campaignWasCreated: campaignResult.wasCreated,
      adSetsUpserted: adSetsResult.upsertedCount,
      adsUpserted: adsResult.upsertedCount,
      metricsUpserted: metricsResult.upsertedCount,
    });

    return NextResponse.json({
      ok: true,
      durationMs,
      campaign: { id: campaignResult.campaign.metaId, wasCreated: campaignResult.wasCreated },
      adSets: { upsertedCount: adSetsResult.upsertedCount },
      ads: { upsertedCount: adsResult.upsertedCount },
      metrics: {
        adCount: metricsResult.adCount,
        upsertedCount: metricsResult.upsertedCount,
        skippedCount: metricsResult.skippedCount,
      },
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);

    await logger.error('sync-metrics cron failed', { error: message, durationMs });

    const campaign = await findCampaignByMetaId(META_CAMPAIGN_ID).catch(() => null);
    if (campaign) {
      await createSyncRun({
        campaignId: campaign.id,
        success: false,
        errorMessage: message,
        durationMs,
      }).catch(() => undefined);
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
