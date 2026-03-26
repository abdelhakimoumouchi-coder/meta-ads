/**
 * lib/sync/sync-adsets.ts
 *
 * Fetches ad sets for the managed campaign from the Meta Marketing API and
 * upserts them into the local database.
 *
 * Ad sets hold the daily budget, so keeping this data fresh is critical for
 * the pacing and safety engine.
 */

import type { AdSet } from '@prisma/client';
import { fetchCampaignAdSets } from '../meta/adsets';
import { upsertAdSet, findCampaignByMetaId } from '../db/queries';
import { META_CAMPAIGN_ID } from '../meta/config';
import { createLogger } from '../logs/logger';

const logger = createLogger('sync:adsets');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncAdSetsResult {
  adSets: AdSet[];
  upsertedCount: number;
  skippedCount: number;
}

// ─── Main sync function ───────────────────────────────────────────────────────

/**
 * Fetch all ad sets for the campaign from Meta and persist them.
 *
 * Requires the campaign to already exist in the local DB (sync campaign first).
 * Throws if the campaign record is not found — this indicates a sync ordering issue.
 */
export async function syncAdSets(): Promise<SyncAdSetsResult> {
  logger.debug('Looking up campaign in DB', { metaId: META_CAMPAIGN_ID });

  // Resolve the internal campaign DB ID from the Meta campaign ID.
  const campaign = await findCampaignByMetaId(META_CAMPAIGN_ID);
  if (!campaign) {
    throw new Error(
      `[sync:adsets] Campaign ${META_CAMPAIGN_ID} not found in DB — run syncCampaign() first.`,
    );
  }

  logger.debug('Fetching ad sets from Meta API');
  const rawAdSets = await fetchCampaignAdSets();

  const adSets: AdSet[] = [];
  let upsertedCount = 0;
  let skippedCount = 0;
  const now = new Date();

  for (const raw of rawAdSets) {
    // Parse daily_budget — Meta returns it as a USD-cent string.
    // Guard against null/undefined before parseInt.
    if (!raw.daily_budget) {
      logger.debug('Skipping ad set with missing daily_budget', { metaId: raw.id });
      skippedCount++;
      continue;
    }
    const dailyBudgetCents = parseInt(raw.daily_budget, 10);
    if (Number.isNaN(dailyBudgetCents)) {
      logger.debug('Skipping ad set with unparseable budget', {
        metaId: raw.id,
        rawBudget: raw.daily_budget,
      });
      skippedCount++;
      continue;
    }

    try {
      const adSet = await upsertAdSet({
        metaId: raw.id,
        campaignId: campaign.id, // internal DB ID
        name: raw.name,
        status: raw.status,
        dailyBudgetCents,
        billingEvent: raw.billing_event ?? null,
        optimizationGoal: raw.optimization_goal ?? null,
        startTime: raw.start_time ? new Date(raw.start_time) : null,
        endTime: raw.end_time ? new Date(raw.end_time) : null,
        syncedAt: now,
      });

      adSets.push(adSet);
      upsertedCount++;
    } catch (err) {
      logger.debug('Failed to upsert ad set', {
        metaId: raw.id,
        error: err instanceof Error ? err.message : String(err),
      });
      skippedCount++;
    }
  }

  await logger.info('Ad sets synced', {
    campaignMetaId: META_CAMPAIGN_ID,
    upsertedCount,
    skippedCount,
    total: rawAdSets.length,
  });

  return { adSets, upsertedCount, skippedCount };
}
