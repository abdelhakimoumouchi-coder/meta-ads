/**
 * Scoring model constants.
 *
 * These weights and normalisation targets define how creatives are ranked.
 * The weighted sum of all SCORE_WEIGHTS must equal 1.0.
 *
 * Priority order (highest to lowest):
 *   1. Messaging performance
 *   2. Video quality / retention
 *   3. CTR / click quality
 *   4. Engagement
 *   5. Stability / confidence  (applied as a dampener, not additive weight)
 */

// ─── Component weights ────────────────────────────────────────────────────────

export const SCORE_WEIGHTS = {
  /** Weight for messaging score (conversations + cost-per-conv). */
  messaging: 0.40,
  /** Weight for video retention / quality. */
  video: 0.25,
  /** Weight for CTR / outbound click quality. */
  clicks: 0.20,
  /** Weight for social engagement signals. */
  engagement: 0.15,
} as const;

// Sanity check — must equal 1 in tests.
const _sum = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(_sum - 1.0) > 0.0001) {
  throw new Error(`[scoring] SCORE_WEIGHTS must sum to 1.0, got ${_sum}`);
}

// ─── Normalisation targets ────────────────────────────────────────────────────

/**
 * "Good" cost per conversation in USD.
 * At this value the cost-per-conv component normalises to ~0.5.
 * Below this → higher score; above → lower score.
 */
export const NORM_TARGET_COST_PER_CONV_USD = 5.0;

/**
 * "Good" outbound CTR percentage.
 * At this value the click component normalises to ~0.5.
 */
export const NORM_TARGET_OUTBOUND_CTR_PCT = 1.5;

/**
 * "Good" ThruPlay rate (0–1 fraction of impressions).
 * At this value the video component normalises to ~0.5.
 */
export const NORM_TARGET_THRUPLAY_RATE = 0.15;

/**
 * "Good" engagement rate (0–1 fraction of impressions).
 * At this value the engagement component normalises to ~0.5.
 */
export const NORM_TARGET_ENGAGEMENT_RATE = 0.02;

// ─── Confidence dampening ─────────────────────────────────────────────────────

/**
 * USD spend at which confidence is considered "full" (confidence → 1.0).
 * Below this the score is pulled toward NEUTRAL_SCORE.
 */
export const CONFIDENCE_FULL_SPEND_USD = 20.0;

/**
 * Impression count at which confidence is considered "full".
 * Both spend and impression thresholds are used; the lower confidence wins.
 */
export const CONFIDENCE_FULL_IMPRESSIONS = 500;

/**
 * Neutral / prior score used when confidence is low.
 * Score is interpolated between actual_score and NEUTRAL_SCORE based on confidence.
 * 0.5 = "no opinion yet".
 */
export const NEUTRAL_SCORE = 0.5;

/**
 * Minimum confidence required before a score component is considered meaningful.
 * Below this threshold the ad is marked as not eligible for reallocation.
 */
export const MIN_CONFIDENCE_FOR_ELIGIBILITY = 0.25;

// ─── Score clamping ───────────────────────────────────────────────────────────

/** Scores are always clamped to [0, 1]. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 1;
