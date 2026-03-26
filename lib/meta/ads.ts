/**
 * lib/meta/ads.ts
 *
 * Helpers for reading ad (creative) data from the Meta Graph API.
 */

import type { MetaAdRaw, MetaListResponse } from '../../types/meta';
import { metaGet, metaGetAll } from './client';
import { META_CAMPAIGN_ID } from './config';

/** Fields we request for every ad fetch. */
const AD_FIELDS = [
  'id',
  'adset_id',
  'campaign_id',
  'name',
  'status',
  'effective_status',
  'creative{id}',
  'created_time',
  'updated_time',
].join(',');

/**
 * Fetch a single ad by its Meta ID.
 */
export async function fetchAd(adId: string): Promise<MetaAdRaw> {
  return metaGet<MetaAdRaw>(adId, { fields: AD_FIELDS });
}

/**
 * Fetch all ads belonging to the configured campaign.
 */
export async function fetchCampaignAds(): Promise<MetaAdRaw[]> {
  return metaGetAll<MetaAdRaw>(
    `${META_CAMPAIGN_ID}/ads`,
    { fields: AD_FIELDS, limit: '50' },
  );
}

/**
 * Fetch a list of ads by IDs in parallel.
 */
export async function fetchAdsByIds(adIds: string[]): Promise<MetaAdRaw[]> {
  if (adIds.length === 0) return [];

  const results = await Promise.allSettled(
    adIds.map((id) => fetchAd(id)),
  );

  const resolved: MetaAdRaw[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      resolved.push(result.value);
    }
  }
  return resolved;
}

/**
 * Fetch all ads belonging to a specific ad set.
 */
export async function fetchAdSetAds(adSetId: string): Promise<MetaAdRaw[]> {
  const response = await metaGet<MetaListResponse<MetaAdRaw>>(
    `${adSetId}/ads`,
    { fields: AD_FIELDS, limit: '50' },
  );
  return response.data;
}
