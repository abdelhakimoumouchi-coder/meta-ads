/**
 * Meta Marketing API constants.
 *
 * All Meta-specific configuration is centralised here.
 * The client code imports these instead of reading process.env directly.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[meta/config] Missing required environment variable: ${name}`);
  }
  return value;
}

function envString(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function envArray(name: string): string[] {
  const raw = process.env[name] ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── API Credentials ──────────────────────────────────────────────────────────

export const META_APP_ID = requireEnv('META_APP_ID');
export const META_APP_SECRET = requireEnv('META_APP_SECRET');
export const META_ACCESS_TOKEN = requireEnv('META_ACCESS_TOKEN');

/** Graph API version, e.g. "v23.0". */
export const META_API_VERSION = envString('META_API_VERSION', 'v23.0');

/** Base URL for all Graph API requests. */
export const META_API_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// ─── Ad Account Identifiers ───────────────────────────────────────────────────

/** Must include the "act_" prefix. */
export const META_AD_ACCOUNT_ID = requireEnv('META_AD_ACCOUNT_ID');

export const META_BUSINESS_ID = envString('META_BUSINESS_ID', '');
export const META_PAGE_ID = envString('META_PAGE_ID', '');
export const META_INSTAGRAM_ID = envString('META_INSTAGRAM_ID', '');
export const META_PIXEL_ID = envString('META_PIXEL_ID', '');

// ─── Campaign / Ad Entity IDs ─────────────────────────────────────────────────

export const META_CAMPAIGN_ID = envString('META_CAMPAIGN_ID', '');

/** List of ad set IDs belonging to the campaign. */
export const META_ADSET_IDS: string[] = envArray('META_ADSET_IDS');

/** List of ad IDs to track (one per creative). */
export const META_AD_IDS: string[] = envArray('META_AD_IDS');

// ─── API Request Defaults ────────────────────────────────────────────────────

/** Default request timeout in milliseconds. */
export const META_REQUEST_TIMEOUT_MS = 15_000;

/** Max retries on transient Meta API errors (rate-limit, 5xx). */
export const META_MAX_RETRIES = 3;

/** Base delay in ms before the first retry. Doubles on each subsequent attempt. */
export const META_RETRY_BASE_DELAY_MS = 1_000;

// ─── Insight Fields ───────────────────────────────────────────────────────────

/**
 * Fields requested when pulling ad-level insights from the API.
 * Adding or removing fields here controls what gets persisted.
 */
export const META_INSIGHT_FIELDS = [
  'ad_id',
  'adset_id',
  'campaign_id',
  'date_start',
  'date_stop',
  'impressions',
  'clicks',
  'reach',
  'frequency',
  'spend',
  'cpm',
  'ctr',
  'cpc',
  'actions',
  'cost_per_action_type',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p100_watched_actions',
  'video_thruplay_watched_actions',
  'outbound_clicks',
  'outbound_clicks_ctr',
] as const;

/** Action type key for messaging conversations started. */
export const META_ACTION_CONVERSATIONS = 'onsite_conversion.messaging_conversation_started_7d';

/** Action type key for link clicks (outbound). */
export const META_ACTION_LINK_CLICK = 'link_click';

/** Action type key for outbound clicks. */
export const META_ACTION_OUTBOUND_CLICK = 'outbound_click';

/** Action types that count as social engagement. */
export const META_ENGAGEMENT_ACTION_TYPES = [
  'post_reaction',
  'comment',
  'post',
] as const;

// ─── Insight Date Preset ──────────────────────────────────────────────────────

/** Default date preset used when fetching lifetime campaign insights. */
export const META_INSIGHTS_DATE_PRESET = 'maximum' as const;

/** Breakdown used for day-by-day metrics. */
export const META_INSIGHTS_TIME_INCREMENT = 1; // 1 = daily
