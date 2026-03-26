/**
 * Metrics types.
 *
 * Normalised performance metrics for a single ad over a given time window.
 * These are computed from the raw Meta insight payloads and stored in the DB.
 */

// ─── Normalised daily snapshot ────────────────────────────────────────────────

/**
 * A fully-typed, normalised snapshot of an ad's performance for one calendar day.
 * All monetary values are in USD (not cents) for readability in business logic.
 * Conversion from cents happens at the persistence boundary.
 */
export interface AdDailyMetrics {
  adId: string;
  campaignId: string;
  /** UTC midnight of the day these metrics cover. */
  date: Date;

  // ── Volume ──────────────────────────────────────────────────────────────────
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  /** Only link/outbound clicks — excludes other click types. */
  linkClicks: number;
  outboundClicks: number;

  // ── Spend ───────────────────────────────────────────────────────────────────
  /** Total spend in USD. */
  spendUsd: number;
  /** Cost per 1 000 impressions (USD). */
  cpm: number;
  /** Click-through rate (0–100). */
  ctr: number;
  /** Cost per click (USD). */
  cpc: number;
  /** Outbound CTR (0–100). */
  outboundCtr: number;

  // ── Messaging ───────────────────────────────────────────────────────────────
  conversationsStarted: number;
  /** USD. 0 if no conversations recorded. */
  costPerConversationUsd: number;

  // ── Video retention ─────────────────────────────────────────────────────────
  /** Number of video plays that reached the 25 % mark. */
  videoPct25: number;
  videoPct50: number;
  videoPct75: number;
  videoPct100: number;
  /** ThruPlay: plays to completion (or 15 s for longer videos). */
  videoThruPlays: number;

  // ── Engagement ──────────────────────────────────────────────────────────────
  reactions: number;
  comments: number;
  shares: number;
}

// ─── Aggregated window metrics ────────────────────────────────────────────────

/**
 * Metrics aggregated over the full available window (since campaign start).
 * Used by the scoring model.
 */
export type AdWindowMetrics = AdDailyMetrics;

// ─── Derived / computed metrics ───────────────────────────────────────────────

/**
 * Secondary metrics computed from raw ones.
 * Calculated on-the-fly and never persisted.
 */
export interface AdDerivedMetrics {
  adId: string;
  /** ThruPlay rate = thruPlays / impressions (0–1). */
  thruPlayRate: number;
  /** 15-second (or full) video view rate = videoPct75 / impressions (0–1). */
  videoRetentionRate: number;
  /** Engagement rate = (reactions + comments + shares) / impressions (0–1). */
  engagementRate: number;
  /**
   * Data confidence score (0–1).
   * Increases as spend and impressions grow.  Used to dampen volatile scores
   * from ads with very little data.
   */
  confidenceScore: number;
}
