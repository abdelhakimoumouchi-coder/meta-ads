/**
 * lib/meta/adsets.ts
 *
 * Helpers for reading and managing ad sets via the Meta Graph API.
 */

import type { MetaAdSetRaw, MetaListResponse } from '../../types/meta';
import { metaGet, metaGetAll } from './client';
import { META_CAMPAIGN_ID } from './config';

/** Fields we request for every ad set fetch. */
const ADSET_FIELDS = [
  'id',
  'campaign_id',
  'name',
  'status',
  'effective_status',
  'daily_budget',
  'billing_event',
  'optimization_goal',
  'start_time',
  'end_time',
  'created_time',
  'updated_time',
].join(',');

/**
 * Fetch a single ad set by its Meta ID.
 */
export async function fetchAdSet(adSetId: string): Promise<MetaAdSetRaw> {
  return metaGet<MetaAdSetRaw>(adSetId, { fields: ADSET_FIELDS });
}

/**
 * Fetch all ad sets belonging to the configured campaign.
 * Uses cursor-based pagination to handle campaigns with many ad sets.
 */
export async function fetchCampaignAdSets(): Promise<MetaAdSetRaw[]> {
  return metaGetAll<MetaAdSetRaw>(
    `${META_CAMPAIGN_ID}/adsets`,
    { fields: ADSET_FIELDS, limit: '50' },
  );
}

/**
 * Fetch a list of ad sets by their IDs in parallel.
 * Useful when we have a known list from META_ADSET_IDS.
 */
export async function fetchAdSetsByIds(adSetIds: string[]): Promise<MetaAdSetRaw[]> {
  if (adSetIds.length === 0) return [];

  const results = await Promise.allSettled(
    adSetIds.map((id) => fetchAdSet(id)),
  );

  const resolved: MetaAdSetRaw[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      resolved.push(result.value);
    }
    // Rejected ad sets are silently skipped — callers can check the count.
  }
  return resolved;
}

/**
 * Fetch the first page of ad sets for the campaign.
 * Returns the raw MetaListResponse so callers can inspect paging if needed.
 */
export async function fetchAdSetsPage(
  after?: string,
): Promise<MetaListResponse<MetaAdSetRaw>> {
  const params: Record<string, string | number | boolean> = {
    fields: ADSET_FIELDS,
    limit: 25,
  };
  if (after) params.after = after;

  return metaGet<MetaListResponse<MetaAdSetRaw>>(
    `${META_CAMPAIGN_ID}/adsets`,
    params,
  );
}
