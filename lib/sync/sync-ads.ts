/**
 * lib/sync/sync-ads.ts
 *
 * Fetches ads (creatives) for the managed campaign from the Meta Marketing API
 * and upserts them into the local database.
 *
 * Ads must be synced after ad sets, because the Ad record holds a foreign key
 * to its parent AdSet (internal DB ID).
 */

import type { Ad } from '@prisma/client';
import { fetchCampaignAds } from '../meta/ads';
import { upsertAd, findCampaignByMetaId, findAdSetByMetaId } from '../db/queries';
import { META_CAMPAIGN_ID } from '../meta/config';
import { createLogger } from '../logs/logger';

const logger = createLogger('sync:ads');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncAdsResult {
  ads: Ad[];
  upsertedCount: number;
  skippedCount: number;
}

// ─── Main sync function ───────────────────────────────────────────────────────

/**
 * Fetch all ads for the campaign from Meta and persist them.
 *
 * Requires campaign and ad set records to exist in the DB.
 * Ads whose parent ad set is not found in the DB are skipped with a warning.
 */
export async function syncAds(): Promise<SyncAdsResult> {
  logger.debug('Looking up campaign in DB', { metaId: META_CAMPAIGN_ID });

  const campaign = await findCampaignByMetaId(META_CAMPAIGN_ID);
  if (!campaign) {
    throw new Error(
      `[sync:ads] Campaign ${META_CAMPAIGN_ID} not found in DB — run syncCampaign() first.`,
    );
  }

  logger.debug('Fetching ads from Meta API');
  const rawAds = await fetchCampaignAds();

  const ads: Ad[] = [];
  let upsertedCount = 0;
  let skippedCount = 0;
  const now = new Date();

  for (const raw of rawAds) {
    // Resolve the parent AdSet's internal DB ID.
    const adSet = await findAdSetByMetaId(raw.adset_id);
    if (!adSet) {
      await logger.warn('Ad set not found in DB — skipping ad', {
        adMetaId: raw.id,
        adSetMetaId: raw.adset_id,
      });
      skippedCount++;
      continue;
    }

    try {
      const ad = await upsertAd({
        metaId: raw.id,
        adSetId: adSet.id,       // internal DB ID
        campaignId: campaign.id, // internal DB ID
        name: raw.name,
        status: raw.status,
        creativeId: raw.creative?.id ?? null,
        syncedAt: now,
      });

      ads.push(ad);
      upsertedCount++;
    } catch (err) {
      await logger.warn('Failed to upsert ad', {
        metaId: raw.id,
        error: err instanceof Error ? err.message : String(err),
      });
      skippedCount++;
    }
  }

  await logger.info('Ads synced', {
    campaignMetaId: META_CAMPAIGN_ID,
    upsertedCount,
    skippedCount,
    total: rawAds.length,
  });

  return { ads, upsertedCount, skippedCount };
}
