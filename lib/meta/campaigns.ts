/**
 * lib/meta/campaigns.ts
 *
 * Helpers for reading campaign data from the Meta Graph API.
 */

import type { MetaCampaignRaw, MetaListResponse } from '../../types/meta';
import { metaGet } from './client';
import { META_AD_ACCOUNT_ID, META_CAMPAIGN_ID } from './config';

/** Fields we always request when fetching a campaign. */
const CAMPAIGN_FIELDS = [
  'id',
  'name',
  'status',
  'effective_status',
  'objective',
  'daily_budget',
  'lifetime_budget',
  'start_time',
  'stop_time',
  'created_time',
  'updated_time',
].join(',');

/**
 * Fetch the single campaign we manage.
 *
 * @param campaignMetaId  Override the META_CAMPAIGN_ID env var.
 */
export async function fetchCampaign(campaignMetaId?: string): Promise<MetaCampaignRaw> {
  const id = campaignMetaId ?? META_CAMPAIGN_ID;
  if (!id) {
    throw new Error(
      '[meta/campaigns] campaignMetaId is required — pass it explicitly or set META_CAMPAIGN_ID in env.',
    );
  }
  return metaGet<MetaCampaignRaw>(id, {
    fields: CAMPAIGN_FIELDS,
  });
}

/**
 * Fetch all campaigns in the ad account.
 * Useful for bootstrap / verification scripts — not used in normal operation.
 */
export async function fetchAllCampaigns(): Promise<MetaCampaignRaw[]> {
  const response = await metaGet<MetaListResponse<MetaCampaignRaw>>(
    `${META_AD_ACCOUNT_ID}/campaigns`,
    { fields: CAMPAIGN_FIELDS, limit: '50' },
  );
  return response.data;
}
