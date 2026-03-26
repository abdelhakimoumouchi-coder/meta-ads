/**
 * lib/meta/insights.ts
 *
 * Helpers for fetching performance insights from the Meta Graph API.
 *
 * Meta Insights API reference:
 *   https://developers.facebook.com/docs/marketing-api/insights
 *
 * Key design decisions:
 *   - We always request time_increment=1 (daily granularity)
 *   - We normalise the raw MetaInsightRaw into AdDailyMetrics at this boundary
 *   - Monetary values are kept in USD (as returned by Meta) and converted to
 *     cents only when writing to the database
 */

import type { MetaInsightRaw, MetaListResponse } from '../../types/meta';
import type { AdDailyMetrics } from '../../types/metrics';
import { metaGet } from './client';
import {
  META_ACTION_CONVERSATIONS,
  META_INSIGHT_FIELDS,
  META_INSIGHTS_DATE_PRESET,
  META_INSIGHTS_TIME_INCREMENT,
} from './config';

// ─── Fetch raw insights ───────────────────────────────────────────────────────

/**
 * Fetch daily insights for a single ad over the maximum available date range.
 */
export async function fetchAdInsights(adId: string): Promise<MetaInsightRaw[]> {
  const response = await metaGet<MetaListResponse<MetaInsightRaw>>(
    `${adId}/insights`,
    {
      fields: META_INSIGHT_FIELDS.join(','),
      date_preset: META_INSIGHTS_DATE_PRESET,
      time_increment: META_INSIGHTS_TIME_INCREMENT,
      limit: 90, // up to 90 days — more than enough for a 6-day campaign
    },
  );
  return response.data;
}

/**
 * Fetch daily insights for a specific date range (YYYY-MM-DD strings).
 */
export async function fetchAdInsightsRange(
  adId: string,
  since: string,
  until: string,
): Promise<MetaInsightRaw[]> {
  const response = await metaGet<MetaListResponse<MetaInsightRaw>>(
    `${adId}/insights`,
    {
      fields: META_INSIGHT_FIELDS.join(','),
      time_range: JSON.stringify({ since, until }),
      time_increment: META_INSIGHTS_TIME_INCREMENT,
      limit: 90,
    },
  );
  return response.data;
}

/**
 * Fetch insights for multiple ads in parallel.
 * Returns a flat array of all raw insight rows across all ads.
 */
export async function fetchMultipleAdInsights(
  adIds: string[],
): Promise<MetaInsightRaw[]> {
  if (adIds.length === 0) return [];

  const results = await Promise.allSettled(
    adIds.map((id) => fetchAdInsights(id)),
  );

  const all: MetaInsightRaw[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      all.push(...result.value);
    }
    // Rejections are silently dropped; the caller can compare expected vs actual counts.
  }
  return all;
}

/**
 * Fetch campaign-level aggregate insights (no ad breakdown).
 */
export async function fetchCampaignInsights(
  campaignId: string,
): Promise<MetaInsightRaw[]> {
  const response = await metaGet<MetaListResponse<MetaInsightRaw>>(
    `${campaignId}/insights`,
    {
      fields: META_INSIGHT_FIELDS.join(','),
      date_preset: META_INSIGHTS_DATE_PRESET,
      time_increment: META_INSIGHTS_TIME_INCREMENT,
      limit: 90,
    },
  );
  return response.data;
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

/**
 * Extract the numeric value from a Meta action array by action_type.
 * Returns 0 if the action type is not present.
 */
function extractAction(
  actions: Array<{ action_type: string; value: string }> | undefined,
  actionType: string,
): number {
  if (!actions) return 0;
  const match = actions.find((a) => a.action_type === actionType);
  return match ? parseFloat(match.value) || 0 : 0;
}

/**
 * Parse a Meta numeric string (which may be undefined or empty) to a float.
 * Returns 0 on failure.
 */
function parseMetaFloat(value: string | undefined): number {
  if (!value) return 0;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Parse a Meta numeric string to an integer.
 * Returns 0 on failure.
 */
function parseMetaInt(value: string | undefined): number {
  if (!value) return 0;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Normalise a raw MetaInsightRaw row into a typed AdDailyMetrics object.
 *
 * Requires the insight row to have an `ad_id` field.
 * Throws if ad_id is missing (caller should only pass ad-level rows).
 */
export function normaliseInsightRow(raw: MetaInsightRaw): AdDailyMetrics {
  if (!raw.ad_id) {
    throw new Error('[insights] normaliseInsightRow called on a row without ad_id');
  }

  const impressions = parseMetaInt(raw.impressions);
  const spendUsd = parseMetaFloat(raw.spend);
  const conversationsStarted = extractAction(raw.actions, META_ACTION_CONVERSATIONS);
  const costPerConvUsd =
    conversationsStarted > 0
      ? extractAction(raw.cost_per_action_type, META_ACTION_CONVERSATIONS)
      : 0;

  // Video retention stats — each is a count of views that reached that threshold.
  const videoPct25 = extractAction(raw.video_p25_watched_actions, 'video_view');
  const videoPct50 = extractAction(raw.video_p50_watched_actions, 'video_view');
  const videoPct75 = extractAction(raw.video_p75_watched_actions, 'video_view');
  const videoPct100 = extractAction(raw.video_p100_watched_actions, 'video_view');
  const videoThruPlays = extractAction(raw.video_thruplay_watched_actions, 'video_view');

  // Outbound clicks
  const outboundClicks = extractAction(raw.outbound_clicks, 'outbound_click');
  const outboundCtr = extractAction(raw.outbound_clicks_ctr, 'outbound_click');

  // Social engagement
  const reactions = extractAction(raw.actions, 'post_reaction');
  const comments = extractAction(raw.actions, 'comment');
  const shares = extractAction(raw.actions, 'post');

  return {
    adId: raw.ad_id,
    campaignId: raw.campaign_id,
    date: new Date(`${raw.date_start}T00:00:00.000Z`),

    impressions,
    reach: parseMetaInt(raw.reach),
    frequency: parseMetaFloat(raw.frequency),
    clicks: parseMetaInt(raw.clicks),
    linkClicks: parseMetaInt(raw.clicks), // link clicks = clicks in our request
    outboundClicks: Math.round(outboundClicks),

    spendUsd,
    cpm: parseMetaFloat(raw.cpm),
    ctr: parseMetaFloat(raw.ctr),
    cpc: parseMetaFloat(raw.cpc),
    outboundCtr,

    conversationsStarted: Math.round(conversationsStarted),
    costPerConversationUsd: costPerConvUsd,

    videoPct25: Math.round(videoPct25),
    videoPct50: Math.round(videoPct50),
    videoPct75: Math.round(videoPct75),
    videoPct100: Math.round(videoPct100),
    videoThruPlays: Math.round(videoThruPlays),

    reactions: Math.round(reactions),
    comments: Math.round(comments),
    shares: Math.round(shares),
  };
}

/**
 * Normalise an array of raw insight rows, skipping rows without ad_id.
 */
export function normaliseInsights(rows: MetaInsightRaw[]): AdDailyMetrics[] {
  const results: AdDailyMetrics[] = [];
  for (const row of rows) {
    if (!row.ad_id) continue;
    try {
      results.push(normaliseInsightRow(row));
    } catch {
      // Skip malformed rows; they will surface as missing data, not crashes.
    }
  }
  return results;
}
