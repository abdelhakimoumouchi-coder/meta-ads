/**
 * lib/optimizer/normalization.ts
 *
 * Metric normalisation helpers for the creative scoring model.
 *
 * Raw metrics from the Meta API span very different scales:
 *   - Impressions: 0 – 100,000+
 *   - Cost per conversation: $0 – $50+
 *   - ThruPlay rate: 0 – 1
 *
 * To compare ads fairly, we normalise each component to [0, 1].
 *
 * All functions here are pure — they accept explicit "target" parameters
 * rather than reading from module-level state, making them trivially testable.
 *
 * The normalisation strategy for each component:
 * - "higher is better" metrics use a soft sigmoid  (normalizeWithTarget)
 * - "lower is better" metrics use an inverse curve (normalizeLowerIsBetter)
 * - confidence uses a linear ramp                  (normalizeLinear)
 */

import {
  normalizeLinear,
  normalizeLowerIsBetter,
  normalizeWithTarget,
  safeDivide,
  clamp,
} from '../utils/math';
import {
  CONFIDENCE_FULL_IMPRESSIONS,
  CONFIDENCE_FULL_SPEND_USD,
  NORM_TARGET_COST_PER_CONV_USD,
  NORM_TARGET_OUTBOUND_CTR_PCT,
  NORM_TARGET_THRUPLAY_RATE,
  NORM_TARGET_ENGAGEMENT_RATE,
} from '../constants/scoring';
import type { AdDailyMetrics } from '../../types/metrics';

// ─── Types ────────────────────────────────────────────────────────────────────

/** All inputs needed to compute the normalised score components for one ad. */
export interface NormalizationInput {
  /** Total impressions across the evaluation window. */
  impressions: number;
  /** Total spend across the window (USD). */
  spendUsd: number;
  /** Total messaging conversations started. */
  conversationsStarted: number;
  /** Cost per conversation (USD). 0 if no conversations. */
  costPerConversationUsd: number;
  /** Total ThruPlay views across the window. */
  videoThruPlays: number;
  /** Total 75 % video views (proxy for quality retention). */
  videoPct75: number;
  /** Outbound CTR (percentage, e.g. 1.5 means 1.5 %). */
  outboundCtr: number;
  /** Total outbound clicks. */
  outboundClicks: number;
  /** Total engagement actions (reactions + comments + shares). */
  totalEngagements: number;
}

export interface NormalisedComponents {
  /** Messaging score [0, 1]. */
  messagingScore: number;
  /** Video retention score [0, 1]. */
  videoScore: number;
  /** Click quality score [0, 1]. */
  clickScore: number;
  /** Engagement score [0, 1]. */
  engagementScore: number;
  /** Confidence score [0, 1] — used as a dampening factor, not an additive component. */
  confidenceScore: number;
}

// ─── Confidence ───────────────────────────────────────────────────────────────

/**
 * Compute data confidence for an ad.
 *
 * Confidence grows linearly as spend and impression counts increase.
 * We take the MINIMUM of the two signals — if either is low we remain cautious.
 *
 * At CONFIDENCE_FULL_SPEND_USD spend AND CONFIDENCE_FULL_IMPRESSIONS impressions,
 * confidence = 1.0.
 */
export function computeConfidence(
  spendUsd: number,
  impressions: number,
): number {
  const spendConf = normalizeLinear(spendUsd, 0, CONFIDENCE_FULL_SPEND_USD);
  const impressionConf = normalizeLinear(
    impressions,
    0,
    CONFIDENCE_FULL_IMPRESSIONS,
  );
  return clamp(Math.min(spendConf, impressionConf), 0, 1);
}

// ─── Component normalisation ──────────────────────────────────────────────────

/**
 * Normalise the messaging performance component.
 *
 * Two sub-signals are combined:
 * 1. Conversation volume   : `normalizeWithTarget(conversations, target_conversations)`
 *    where target_conversations is 1 conversation per NORM_TARGET_COST_PER_CONV_USD × 1 USD.
 * 2. Cost efficiency       : `normalizeLowerIsBetter(cost_per_conv, ceiling)`
 *    where ceiling = 3 × NORM_TARGET_COST_PER_CONV_USD (i.e. score = 0 at 3× the target cost).
 *
 * If there are no conversations, volume = 0, cost = 0, and the combined score
 * reflects only the spend signal (ads with spend but no conversations get a low score).
 */
export function normalizeMessagingScore(
  conversationsStarted: number,
  costPerConversationUsd: number,
  spendUsd: number,
): number {
  // Volume sub-signal: how many conversations relative to expectation?
  // We expect ~1 conv per $NORM_TARGET_COST_PER_CONV_USD spent.
  const expectedConversations = safeDivide(spendUsd, NORM_TARGET_COST_PER_CONV_USD);
  const volumeScore = normalizeWithTarget(conversationsStarted, Math.max(expectedConversations, 0.5));

  // Cost sub-signal: lower cost per conversation is better.
  const costCeiling = NORM_TARGET_COST_PER_CONV_USD * 3;
  const costScore =
    conversationsStarted > 0
      ? normalizeLowerIsBetter(costPerConversationUsd, costCeiling)
      : 0;

  // If we have conversations, weight cost more; if not, punish the ad.
  const combined =
    conversationsStarted > 0
      ? 0.4 * volumeScore + 0.6 * costScore
      : volumeScore * 0.5; // penalty: no conversations despite spend

  return clamp(combined, 0, 1);
}

/**
 * Normalise the video quality component.
 *
 * Uses ThruPlay rate (thruPlays / impressions) as the primary signal.
 * Also incorporates 75 % view rate for additional depth of engagement signal.
 */
export function normalizeVideoScore(
  videoThruPlays: number,
  videoPct75: number,
  impressions: number,
): number {
  if (impressions === 0) return 0;

  const thruPlayRate = safeDivide(videoThruPlays, impressions);
  const pct75Rate = safeDivide(videoPct75, impressions);

  const thruPlayScore = normalizeWithTarget(
    thruPlayRate,
    NORM_TARGET_THRUPLAY_RATE,
  );
  const pct75Score = normalizeWithTarget(pct75Rate, NORM_TARGET_THRUPLAY_RATE * 1.5);

  return clamp(0.7 * thruPlayScore + 0.3 * pct75Score, 0, 1);
}

/**
 * Normalise the click quality component.
 *
 * Uses outbound CTR (percentage) as the primary signal.
 * Also uses raw outbound click volume as a supporting signal.
 */
export function normalizeClickScore(
  outboundCtr: number,
  outboundClicks: number,
  impressions: number,
): number {
  if (impressions === 0) return 0;

  // CTR signal
  const ctrScore = normalizeWithTarget(outboundCtr, NORM_TARGET_OUTBOUND_CTR_PCT);

  // Volume signal — complements CTR with raw click count.
  // We expect clicks proportional to impressions at the target CTR.
  const expectedClicks = impressions * (NORM_TARGET_OUTBOUND_CTR_PCT / 100);
  const volumeScore = normalizeWithTarget(outboundClicks, Math.max(expectedClicks, 1));

  return clamp(0.7 * ctrScore + 0.3 * volumeScore, 0, 1);
}

/**
 * Normalise the engagement component.
 *
 * Uses overall engagement rate = (reactions + comments + shares) / impressions.
 */
export function normalizeEngagementScore(
  totalEngagements: number,
  impressions: number,
): number {
  if (impressions === 0) return 0;
  const engagementRate = safeDivide(totalEngagements, impressions);
  return clamp(
    normalizeWithTarget(engagementRate, NORM_TARGET_ENGAGEMENT_RATE),
    0,
    1,
  );
}

// ─── Aggregate normalisation ──────────────────────────────────────────────────

/**
 * Compute all normalised score components for a single ad from its aggregated
 * metric inputs.
 *
 * This is the main entry point for the scoring model.
 * It converts raw metric sums into [0, 1] component scores + a confidence value.
 */
export function normalizeAdMetrics(input: NormalizationInput): NormalisedComponents {
  const messagingScore = normalizeMessagingScore(
    input.conversationsStarted,
    input.costPerConversationUsd,
    input.spendUsd,
  );

  const videoScore = normalizeVideoScore(
    input.videoThruPlays,
    input.videoPct75,
    input.impressions,
  );

  const clickScore = normalizeClickScore(
    input.outboundCtr,
    input.outboundClicks,
    input.impressions,
  );

  const engagementScore = normalizeEngagementScore(
    input.totalEngagements,
    input.impressions,
  );

  const confidenceScore = computeConfidence(input.spendUsd, input.impressions);

  return {
    messagingScore,
    videoScore,
    clickScore,
    engagementScore,
    confidenceScore,
  };
}

// ─── Aggregation helper ───────────────────────────────────────────────────────

/**
 * Aggregate an array of daily metrics snapshots into a single summed input
 * suitable for `normalizeAdMetrics`.
 *
 * Rates (CTR, cost per conv) are re-derived from the sums rather than
 * averaged, to avoid distortion from days with very different volumes.
 */
export function aggregateDailyMetrics(rows: AdDailyMetrics[]): NormalizationInput {
  let impressions = 0;
  let spendUsd = 0;
  let conversationsStarted = 0;
  let videoThruPlays = 0;
  let videoPct75 = 0;
  let outboundClicks = 0;
  let reactions = 0;
  let comments = 0;
  let shares = 0;

  for (const row of rows) {
    impressions += row.impressions;
    spendUsd += row.spendUsd;
    conversationsStarted += row.conversationsStarted;
    videoThruPlays += row.videoThruPlays;
    videoPct75 += row.videoPct75;
    outboundClicks += row.outboundClicks;
    reactions += row.reactions;
    comments += row.comments;
    shares += row.shares;
  }

  // Re-derive rates from totals for accuracy.
  const costPerConversationUsd =
    conversationsStarted > 0
      ? safeDivide(spendUsd, conversationsStarted)
      : 0;

  const outboundCtr =
    impressions > 0
      ? safeDivide(outboundClicks, impressions) * 100
      : 0;

  return {
    impressions,
    spendUsd,
    conversationsStarted,
    costPerConversationUsd,
    videoThruPlays,
    videoPct75,
    outboundCtr,
    outboundClicks,
    totalEngagements: reactions + comments + shares,
  };
}
