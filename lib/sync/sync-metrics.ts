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
import { upsertAdMetrics, findCampaignByMetaId, listAdsForCampaign } from '../db/queries';
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
 * Sync performance metrics for all tracked ads belonging to a campaign.
 *
 * @param campaignMetaId  Meta campaign ID to sync.  Falls back to the
 *                        META_CAMPAIGN_ID environment variable when omitted.
 *
 * Ad IDs are resolved from the DB (all ads for the campaign) so the sync is
 * self-contained per campaign and does not rely on META_AD_IDS env being set.
 * META_AD_IDS is used as an override only when no campaignMetaId is provided.
 *
 * Requires campaign and ad records to exist in the DB.
 */
export async function syncMetrics(campaignMetaId?: string): Promise<SyncMetricsResult> {
  const metaId = campaignMetaId ?? META_CAMPAIGN_ID;
  logger.debug('Resolving campaign in DB', { metaId });

  const campaign = await findCampaignByMetaId(metaId);
  if (!campaign) {
    throw new Error(
      `[sync:metrics] Campaign ${metaId} not found in DB — run syncCampaign() first.`,
    );
  }

  // Determine which Meta ad IDs to sync:
  // When a specific campaignMetaId is provided, resolve ads from the DB for that campaign.
  // Otherwise fall back to META_AD_IDS env for backward compatibility.
  let adMetaIds: string[];

  if (campaignMetaId) {
    const campaignAds = await listAdsForCampaign(campaign.id);
    adMetaIds = campaignAds.map((a) => a.metaId);
  } else {
    adMetaIds = META_AD_IDS.length > 0 ? META_AD_IDS : [];
  }

  if (adMetaIds.length === 0) {
    await logger.warn(
      'No ad IDs to sync — run syncAds() first or set META_AD_IDS in .env.',
      { campaignMetaId: metaId },
    );
    return { metricsRows: [], upsertedCount: 0, skippedCount: 0, adCount: 0 };
  }

  // Build a map of metaId → DB ad record to avoid repeated DB lookups.
  const campaignAds = await listAdsForCampaign(campaign.id);
  const adByMetaId = new Map(campaignAds.map((a) => [a.metaId, a]));

  logger.debug('Syncing metrics for ads', { adMetaIds });

  const allMetricsRows: AdMetrics[] = [];
  let upsertedCount = 0;
  let skippedCount = 0;

  for (const adMetaId of adMetaIds) {
    try {
      logger.debug('Fetching insights for ad', { adMetaId });
      const rawRows = await fetchAdInsights(adMetaId);
      const normalisedRows = normaliseInsights(rawRows);

      for (const metrics of normalisedRows) {
        const adRecord = adByMetaId.get(adMetaId);
        if (!adRecord) {
          await logger.warn('Ad not found in DB — skipping metrics row', { adMetaId });
          skippedCount++;
          continue;
        }

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
    campaignMetaId: metaId,
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
