/**
 * lib/optimizer/classifier.ts
 *
 * Ad performance classifier.
 *
 * Translates numeric scores and metrics into human-readable performance tiers,
 * which are used by the dashboard and by the decision engine for logging.
 *
 * Performance tiers:
 *   STAR       – Top performer. Score ≥ 0.7. Candidate for budget increase.
 *   SOLID      – Good performer. Score 0.5–0.69. Keep current budget.
 *   LAGGING    – Below average. Score 0.3–0.49. Small budget decrease.
 *   WEAK       – Poor performer. Score < 0.3. Larger budget decrease.
 *   NO_DATA    – Insufficient data for classification.
 *
 * All functions are pure.
 */

import type { AdScore } from '../../types/optimizer';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PerformanceTier =
  | 'STAR'
  | 'SOLID'
  | 'LAGGING'
  | 'WEAK'
  | 'NO_DATA';

export interface ClassifiedAd {
  adId: string;
  tier: PerformanceTier;
  finalScore: number;
  isEligible: boolean;
  /** Suggested budget direction given this tier. */
  budgetDirection: 'INCREASE' | 'HOLD' | 'DECREASE' | 'UNKNOWN';
}

// ─── Tier thresholds ──────────────────────────────────────────────────────────

const STAR_THRESHOLD = 0.7;
const SOLID_THRESHOLD = 0.5;
const LAGGING_THRESHOLD = 0.3;

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Classify a single ad's performance based on its final score.
 *
 * Ineligible ads (insufficient data) are always classified as NO_DATA
 * regardless of their computed score.
 */
export function classifyAd(score: AdScore): ClassifiedAd {
  if (!score.isEligible) {
    return {
      adId: score.adId,
      tier: 'NO_DATA',
      finalScore: score.finalScore,
      isEligible: false,
      budgetDirection: 'UNKNOWN',
    };
  }

  const tier = getTier(score.finalScore);
  return {
    adId: score.adId,
    tier,
    finalScore: score.finalScore,
    isEligible: true,
    budgetDirection: getBudgetDirection(tier),
  };
}

/**
 * Map a score to a performance tier.
 * Pure function with no side effects.
 */
export function getTier(finalScore: number): PerformanceTier {
  if (finalScore >= STAR_THRESHOLD) return 'STAR';
  if (finalScore >= SOLID_THRESHOLD) return 'SOLID';
  if (finalScore >= LAGGING_THRESHOLD) return 'LAGGING';
  return 'WEAK';
}

/**
 * Map a performance tier to a suggested budget direction.
 */
export function getBudgetDirection(
  tier: PerformanceTier,
): ClassifiedAd['budgetDirection'] {
  switch (tier) {
    case 'STAR':
      return 'INCREASE';
    case 'SOLID':
      return 'HOLD';
    case 'LAGGING':
    case 'WEAK':
      return 'DECREASE';
    case 'NO_DATA':
    default:
      return 'UNKNOWN';
  }
}

/**
 * Classify all ads from an array of AdScore objects.
 *
 * @returns Array of ClassifiedAd, sorted by finalScore descending (same order as scores).
 */
export function classifyAllAds(scores: AdScore[]): ClassifiedAd[] {
  return scores.map(classifyAd);
}

/**
 * Returns a human-readable summary of the performance distribution.
 * Useful for logging and the dashboard.
 */
export function summarizeClassifications(classified: ClassifiedAd[]): string {
  const counts: Record<PerformanceTier, number> = {
    STAR: 0,
    SOLID: 0,
    LAGGING: 0,
    WEAK: 0,
    NO_DATA: 0,
  };

  for (const ad of classified) {
    counts[ad.tier]++;
  }

  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([tier, count]) => `${tier}: ${count}`)
    .join(', ');
}
