/**
 * lib/optimizer/scoring.ts
 *
 * Creative scoring model.
 *
 * Combines normalised score components into a single final score per ad
 * using the weighted model defined in lib/constants/scoring.ts.
 *
 * Key design decisions:
 * 1. Weighted sum of components:
 *    final_raw = (messaging × 0.40) + (video × 0.25) + (clicks × 0.20) + (engagement × 0.15)
 *
 * 2. Confidence dampening:
 *    final_score = NEUTRAL_SCORE + (final_raw - NEUTRAL_SCORE) × confidence
 *    At confidence = 0 → final_score = NEUTRAL_SCORE (0.5, no opinion).
 *    At confidence = 1 → final_score = final_raw (fully trusted).
 *
 * 3. Eligibility guard:
 *    An ad with confidence < MIN_CONFIDENCE_FOR_ELIGIBILITY is marked
 *    ineligible — it keeps its current budget during reallocation.
 *
 * All functions are pure.
 */

import { clamp, dampScore } from '../utils/math';
import {
  SCORE_WEIGHTS,
  NEUTRAL_SCORE,
  MIN_CONFIDENCE_FOR_ELIGIBILITY,
  SCORE_MIN,
  SCORE_MAX,
} from '../constants/scoring';
import {
  MIN_SPEND_BEFORE_DECISION,
} from '../constants/app';
import {
  MIN_IMPRESSIONS_BEFORE_DECISION,
} from '../constants/optimizer';
import {
  normalizeAdMetrics,
  aggregateDailyMetrics,
  type NormalisedComponents,
} from './normalization';
import type { AdScore, AdScoreComponents } from '../../types/optimizer';
import type { AdDailyMetrics } from '../../types/metrics';

// ─── Raw weighted score ───────────────────────────────────────────────────────

/**
 * Compute the weighted sum of score components.
 * Does NOT apply confidence dampening — that happens in `applyConfidenceDampening`.
 *
 * @returns A raw score in [0, 1].
 */
export function computeWeightedScore(components: NormalisedComponents): number {
  const raw =
    components.messagingScore * SCORE_WEIGHTS.messaging +
    components.videoScore * SCORE_WEIGHTS.video +
    components.clickScore * SCORE_WEIGHTS.clicks +
    components.engagementScore * SCORE_WEIGHTS.engagement;

  return clamp(raw, SCORE_MIN, SCORE_MAX);
}

// ─── Confidence dampening ─────────────────────────────────────────────────────

/**
 * Apply confidence dampening to a raw score.
 *
 * When confidence is 0: returns NEUTRAL_SCORE (0.5 — "no opinion yet").
 * When confidence is 1: returns the raw score unchanged.
 * In between: linearly interpolated.
 */
export function applyConfidenceDampening(
  rawScore: number,
  confidence: number,
): number {
  return clamp(dampScore(rawScore, confidence, NEUTRAL_SCORE), SCORE_MIN, SCORE_MAX);
}

// ─── Eligibility check ────────────────────────────────────────────────────────

/**
 * Determine whether an ad has accumulated enough data to influence reallocation.
 *
 * An ad is eligible when:
 * - confidence >= MIN_CONFIDENCE_FOR_ELIGIBILITY
 * - spend >= MIN_SPEND_BEFORE_DECISION (USD)
 * - impressions >= MIN_IMPRESSIONS_BEFORE_DECISION
 */
export function isEligibleForReallocation(
  confidence: number,
  spendUsd: number,
  impressions: number,
): boolean {
  return (
    confidence >= MIN_CONFIDENCE_FOR_ELIGIBILITY &&
    spendUsd >= MIN_SPEND_BEFORE_DECISION &&
    impressions >= MIN_IMPRESSIONS_BEFORE_DECISION
  );
}

// ─── Single ad scoring ────────────────────────────────────────────────────────

/**
 * Score a single ad from its aggregated performance metrics.
 *
 * @param adId       Meta ad ID.
 * @param metrics    Array of daily snapshots for this ad (full campaign window).
 */
export function scoreAd(adId: string, metrics: AdDailyMetrics[]): AdScore {
  // Aggregate all daily rows into a single window view.
  const aggregated = aggregateDailyMetrics(metrics);

  // Normalise each component.
  const norm = normalizeAdMetrics(aggregated);

  const components: AdScoreComponents = {
    messagingScore: norm.messagingScore,
    videoScore: norm.videoScore,
    clickScore: norm.clickScore,
    engagementScore: norm.engagementScore,
    confidenceScore: norm.confidenceScore,
  };

  const rawScore = computeWeightedScore(norm);
  const finalScore = applyConfidenceDampening(rawScore, norm.confidenceScore);

  const eligible = isEligibleForReallocation(
    norm.confidenceScore,
    aggregated.spendUsd,
    aggregated.impressions,
  );

  return {
    adId,
    components,
    finalScore,
    spendUsd: aggregated.spendUsd,
    isEligible: eligible,
  };
}

// ─── Multi-ad scoring ─────────────────────────────────────────────────────────

/**
 * Score all ads from a map of adId → daily metric rows.
 *
 * @param metricsMap  Map of Meta ad ID to an array of daily snapshots.
 * @returns           Array of AdScore objects, sorted by finalScore descending.
 */
export function scoreAllAds(
  metricsMap: Map<string, AdDailyMetrics[]>,
): AdScore[] {
  const scores: AdScore[] = [];

  for (const [adId, metrics] of Array.from(metricsMap.entries())) {
    scores.push(scoreAd(adId, metrics));
  }

  // Deterministic sort: highest score first; ties broken by adId for stability.
  scores.sort((a, b) => {
    const diff = b.finalScore - a.finalScore;
    return diff !== 0 ? diff : a.adId.localeCompare(b.adId);
  });

  return scores;
}
