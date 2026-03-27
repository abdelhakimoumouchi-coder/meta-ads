/**
 * lib/sync/sync-campaign.ts
 *
 * Fetches the managed campaign from the Meta Marketing API and upserts it
 * into the local database.
 *
 * Called by the `/api/cron/sync-metrics` route and the manual-sync script.
 */

import type { Campaign } from '@prisma/client';
import { fetchCampaign } from '../meta/campaigns';
import { upsertCampaign } from '../db/queries';
import { createLogger } from '../logs/logger';

const logger = createLogger('sync:campaign');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncCampaignResult {
  campaign: Campaign;
  /** True if the record was created; false if it was updated. */
  wasCreated: boolean;
}

// ─── Main sync function ───────────────────────────────────────────────────────

/**
 * Fetch the campaign from Meta and persist it.
 *
 * @param campaignMetaId  Meta campaign ID to sync.  Falls back to the
 *                        META_CAMPAIGN_ID environment variable when omitted.
 *
 * Returns the upserted Prisma Campaign record.
 * Throws on Meta API errors — the caller should catch and log.
 */
export async function syncCampaign(campaignMetaId?: string): Promise<SyncCampaignResult> {
  logger.debug('Fetching campaign from Meta API');

  const raw = await fetchCampaign(campaignMetaId);

  // Parse budget fields (Meta returns USD cents as strings).
  const dailyBudgetCents = raw.daily_budget
    ? parseInt(raw.daily_budget, 10) || null
    : null;
  const lifetimeBudgetCents = raw.lifetime_budget
    ? parseInt(raw.lifetime_budget, 10) || null
    : null;

  const now = new Date();

  // Check if this is a create or update by trying to find the record first.
  // upsertCampaign handles both idempotently.
  const campaign = await upsertCampaign({
    metaId: raw.id,
    name: raw.name,
    status: raw.status,
    dailyBudgetCents,
    lifetimeBudgetCents,
    startDate: raw.start_time ? new Date(raw.start_time) : null,
    stopDate: raw.stop_time ? new Date(raw.stop_time) : null,
    objectiveType: raw.objective ?? null,
    syncedAt: now,
  });

  await logger.info('Campaign synced', {
    metaId: raw.id,
    name: raw.name,
    status: raw.status,
  });

  // Determine whether this was a new record by checking if createdAt ≈ updatedAt.
  // After a create they are the same; after an update, updatedAt > createdAt.
  const wasCreated =
    Math.abs(campaign.updatedAt.getTime() - campaign.createdAt.getTime()) < 1_000;

  return { campaign, wasCreated };
}
