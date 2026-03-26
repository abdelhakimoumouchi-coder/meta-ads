/**
 * Meta Marketing API response shapes.
 *
 * These types describe the raw payloads returned by the Meta Graph API
 * before we normalise them into our internal domain types.
 *
 * Reference: https://developers.facebook.com/docs/marketing-api/reference/
 */

// ─── Common primitives ────────────────────────────────────────────────────────

/** Meta returns numeric values as strings in many insight responses. */
export type MetaNumericString = string;

/** Meta paging cursor wrapper. */
export interface MetaPaging {
  cursors?: {
    before: string;
    after: string;
  };
  next?: string;
  previous?: string;
}

/** Standard list response envelope. */
export interface MetaListResponse<T> {
  data: T[];
  paging?: MetaPaging;
}

/** Standard error shape returned by the Graph API. */
export interface MetaApiError {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export interface MetaApiErrorResponse {
  error: MetaApiError;
}

// ─── Campaign ─────────────────────────────────────────────────────────────────

export interface MetaCampaignRaw {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string;
  /** Daily budget in USD cents as a string (may be absent if lifetime). */
  daily_budget?: MetaNumericString;
  /** Lifetime budget in USD cents as a string (may be absent if daily). */
  lifetime_budget?: MetaNumericString;
  start_time?: string;
  stop_time?: string;
  created_time: string;
  updated_time: string;
}

// ─── AdSet ────────────────────────────────────────────────────────────────────

export interface MetaAdSetRaw {
  id: string;
  campaign_id: string;
  name: string;
  status: string;
  effective_status: string;
  /** Daily budget in USD cents as a string. */
  daily_budget: MetaNumericString;
  billing_event: string;
  optimization_goal: string;
  start_time?: string;
  end_time?: string;
  created_time: string;
  updated_time: string;
}

// ─── Ad ───────────────────────────────────────────────────────────────────────

export interface MetaAdRaw {
  id: string;
  adset_id: string;
  campaign_id: string;
  name: string;
  status: string;
  effective_status: string;
  creative?: {
    id: string;
  };
  created_time: string;
  updated_time: string;
}

// ─── Insights ────────────────────────────────────────────────────────────────

/**
 * Raw insight row for an ad or adset, as returned by the
 * `/{id}/insights` endpoint with the fields we request.
 */
export interface MetaInsightRaw {
  ad_id?: string;
  adset_id?: string;
  campaign_id: string;
  date_start: string;
  date_stop: string;

  impressions: MetaNumericString;
  clicks: MetaNumericString;
  reach: MetaNumericString;
  frequency: MetaNumericString;
  /** Total spend in USD as a decimal string. */
  spend: MetaNumericString;
  cpm: MetaNumericString;
  ctr: MetaNumericString;
  cpc: MetaNumericString;

  /** Array of action type objects. */
  actions?: MetaAction[];
  /** Array of cost-per-action objects. */
  cost_per_action_type?: MetaAction[];
  /** Array of action value objects (for conversion value). */
  action_values?: MetaAction[];

  video_p25_watched_actions?: MetaAction[];
  video_p50_watched_actions?: MetaAction[];
  video_p75_watched_actions?: MetaAction[];
  video_p100_watched_actions?: MetaAction[];
  video_thruplay_watched_actions?: MetaAction[];

  outbound_clicks?: MetaOutboundClick[];
  outbound_clicks_ctr?: MetaOutboundClick[];
}

export interface MetaAction {
  action_type: string;
  value: MetaNumericString;
}

export interface MetaOutboundClick {
  action_type: string;
  value: MetaNumericString;
}

// ─── Budget update ────────────────────────────────────────────────────────────

/** Payload for updating an ad set's daily budget via the Graph API. */
export interface MetaBudgetUpdatePayload {
  /** Daily budget in USD cents as a string. */
  daily_budget: string;
}

export interface MetaBudgetUpdateResponse {
  success: boolean;
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

export interface MetaWebhookEntry {
  id: string;
  time: number;
  changes: MetaWebhookChange[];
}

export interface MetaWebhookChange {
  field: string;
  value: unknown;
}

export interface MetaWebhookPayload {
  object: string;
  entry: MetaWebhookEntry[];
}
