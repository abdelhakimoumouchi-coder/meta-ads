/**
 * lib/sync/sync-metrics.ts
 *
 * Fetches daily performance insights for all tracked ads from the Meta
 * Marketing API and persists them as AdMetrics rows.
 *
 * Strategy:
 * - Fetch the full insight history for each tracked ad (date_preset = "maximum").
 * - Upsert each (adId, date) row so repeated syncs are idempotent.
 * - Monetary values are stored as USD cents in the DB (multiply USD × 100).
 */

import type { AdMetrics } from '@prisma/client';
import { fetchAdInsights, normaliseInsights } from '../meta/insights';
import { upsertAdMetrics, findCampaignByMetaId, findAdByMetaId } from '../db/queries';
import { META_CAMPAIGN_ID, META_AD_IDS } from '../meta/config';
import { usdToCents } from '../utils/money';
import { createLogger } from '../logs/logger';
import type { AdDailyMetrics } from '../../types/metrics';

const logger = createLogger('sync:metrics');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncMetricsResult {
  metricsRows: AdMetrics[];
  upsertedCount: number;
  skippedCount: number;
  adCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Persist a single normalised AdDailyMetrics snapshot for a given ad.
 *
 * @param metrics      Normalised metrics (monetary in USD).
 * @param campaignDbId Internal campaign DB ID.
 * @param adDbId       Internal ad DB ID.
 */
async function persistMetricsRow(
  metrics: AdDailyMetrics,
  campaignDbId: string,
  adDbId: string,
): Promise<AdMetrics> {
  return upsertAdMetrics({
    adId: adDbId,
    campaignId: campaignDbId,
    date: metrics.date,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    linkClicks: metrics.linkClicks,
    // Convert USD → cents for storage.
    spendCents: usdToCents(metrics.spendUsd),
    reach: metrics.reach,
    frequency: metrics.frequency,
    cpm: metrics.cpm,
    ctr: metrics.ctr,
    cpc: metrics.cpc,
    conversationsStarted: metrics.conversationsStarted,
    costPerConversationCents: usdToCents(metrics.costPerConversationUsd),
    videoPct25: metrics.videoPct25,
    videoPct50: metrics.videoPct50,
    videoPct75: metrics.videoPct75,
    videoPct100: metrics.videoPct100,
    videoThruPlays: metrics.videoThruPlays,
    outboundClicks: metrics.outboundClicks,
    outboundCtr: metrics.outboundCtr,
    reactions: metrics.reactions,
    comments: metrics.comments,
    shares: metrics.shares,
  });
}

// ─── Main sync function ───────────────────────────────────────────────────────

/**
 * Sync performance metrics for all configured ads.
 *
 * The list of ad IDs comes from `META_AD_IDS` (set via env) if provided,
 * otherwise all ads for the campaign are fetched from the DB.
 *
 * Requires campaign and ad records to exist in the DB.
 */
export async function syncMetrics(): Promise<SyncMetricsResult> {
  logger.debug('Resolving campaign in DB', { metaId: META_CAMPAIGN_ID });

  const campaign = await findCampaignByMetaId(META_CAMPAIGN_ID);
  if (!campaign) {
    throw new Error(
      `[sync:metrics] Campaign ${META_CAMPAIGN_ID} not found in DB — run syncCampaign() first.`,
    );
  }

  // Determine which Meta ad IDs to sync.
  const adMetaIds = META_AD_IDS.length > 0 ? META_AD_IDS : [];
  if (adMetaIds.length === 0) {
    await logger.warn(
      'META_AD_IDS is empty — no metrics to sync. Set META_AD_IDS in .env.',
    );
    return { metricsRows: [], upsertedCount: 0, skippedCount: 0, adCount: 0 };
  }

  logger.debug('Syncing metrics for ads', { adMetaIds });

  const allMetricsRows: AdMetrics[] = [];
  let upsertedCount = 0;
  let skippedCount = 0;

  for (const adMetaId of adMetaIds) {
    // Resolve internal ad DB ID.
    const adRecord = await findAdByMetaId(adMetaId);
    if (!adRecord) {
      await logger.warn('Ad not found in DB — skipping metrics sync', {
        adMetaId,
      });
      skippedCount++;
      continue;
    }

    try {
      logger.debug('Fetching insights for ad', { adMetaId });
      const rawRows = await fetchAdInsights(adMetaId);
      const normalisedRows = normaliseInsights(rawRows);

      for (const metrics of normalisedRows) {
        try {
          const row = await persistMetricsRow(metrics, campaign.id, adRecord.id);
          allMetricsRows.push(row);
          upsertedCount++;
        } catch (innerErr) {
          logger.debug('Failed to upsert metrics row', {
            adMetaId,
            date: metrics.date.toISOString(),
            error: innerErr instanceof Error ? innerErr.message : String(innerErr),
          });
          skippedCount++;
        }
      }
    } catch (err) {
      await logger.error('Failed to fetch insights for ad', {
        adMetaId,
        error: err instanceof Error ? err.message : String(err),
      });
      skippedCount++;
    }
  }

  await logger.info('Metrics sync complete', {
    adCount: adMetaIds.length,
    upsertedCount,
    skippedCount,
  });

  return {
    metricsRows: allMetricsRows,
    upsertedCount,
    skippedCount,
    adCount: adMetaIds.length,
  };
}
