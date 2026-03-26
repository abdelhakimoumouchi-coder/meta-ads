/**
 * lib/meta/config.ts
 *
 * Centralised, validated Meta API configuration.
 *
 * This module re-exports the constants that are already parsed and validated
 * in lib/constants/meta.ts and adds runtime-derived values (e.g. per-request
 * headers) used by the client layer.
 *
 * Importing this file in a non-server context (e.g. a browser bundle) will
 * throw at module evaluation time because `requireEnv` will fail on missing
 * variables — this is intentional and desirable.
 */

export {
  META_ACCESS_TOKEN,
  META_API_BASE_URL,
  META_API_VERSION,
  META_APP_ID,
  META_APP_SECRET,
  META_AD_ACCOUNT_ID,
  META_BUSINESS_ID,
  META_PAGE_ID,
  META_INSTAGRAM_ID,
  META_PIXEL_ID,
  META_CAMPAIGN_ID,
  META_ADSET_IDS,
  META_AD_IDS,
  META_REQUEST_TIMEOUT_MS,
  META_MAX_RETRIES,
  META_RETRY_BASE_DELAY_MS,
  META_INSIGHT_FIELDS,
  META_ACTION_CONVERSATIONS,
  META_ACTION_LINK_CLICK,
  META_ACTION_OUTBOUND_CLICK,
  META_ENGAGEMENT_ACTION_TYPES,
  META_INSIGHTS_DATE_PRESET,
  META_INSIGHTS_TIME_INCREMENT,
} from '../constants/meta';
