/**
 * Optimizer types.
 *
 * These types drive the scoring model, decision engine, and budget reallocation.
 */

import type { AdBudgetAllocation } from './campaign';

// ─── Pacing ───────────────────────────────────────────────────────────────────

/**
 * Campaign-level pacing state.
 *
 * - UNDER_PACING : spending too slowly; risk of under-delivery.
 * - ON_TRACK     : within acceptable pacing envelope.
 * - OVER_PACING  : spending too fast; risk of exhausting budget early.
 * - DANGER       : critically over pace; safety actions must trigger immediately.
 */
export type PacingState =
  | 'UNDER_PACING'
  | 'ON_TRACK'
  | 'OVER_PACING'
  | 'DANGER';

export interface PacingStatus {
  state: PacingState;
  /** Total spend so far (USD). */
  totalSpentUsd: number;
  /** What we expected to have spent by now based on elapsed time (USD). */
  expectedSpendUsd: number;
  /** How far off from expected, as a fraction (e.g. 0.12 = 12 % over). */
  deviationFraction: number;
  /** Remaining budget after current spend (USD). */
  remainingBudgetUsd: number;
  /** Days remaining in the campaign (may be fractional). */
  daysRemaining: number;
  computedAt: Date;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Normalised score components for a single ad.
 * Each component is a value in [0, 1].
 */
export interface AdScoreComponents {
  /** Messaging: conversations + cost-per-conv signal (0–1). */
  messagingScore: number;
  /** Video quality / retention rate (0–1). */
  videoScore: number;
  /** CTR / outbound click quality (0–1). */
  clickScore: number;
  /** Engagement rate (0–1). */
  engagementScore: number;
  /**
   * Data confidence (0–1).
   * Applied as a dampening multiplier — low confidence pulls final score toward 0.5.
   */
  confidenceScore: number;
}

export interface AdScore {
  adId: string;
  components: AdScoreComponents;
  /** Weighted final score after confidence dampening (0–1). */
  finalScore: number;
  /** USD spent on this ad so far (used for eligibility checks). */
  spendUsd: number;
  /**
   * Whether this ad has enough data to participate in reallocation.
   * If false, it receives its current allocation unchanged.
   */
  isEligible: boolean;
}

// ─── Decision ────────────────────────────────────────────────────────────────

export type OptimizationTrigger = 'cron' | 'manual';

/**
 * Reasons why an optimization run was skipped without reallocation.
 */
export type SkipReason =
  | 'TOO_SOON'           // last reallocation was < 48 h ago
  | 'INSUFFICIENT_DATA'  // no ads have enough spend to score reliably
  | 'DANGER_PACING'      // budget guard has taken over; optimizer is frozen
  | 'NO_CHANGE_NEEDED'   // scores are close enough that reallocation is not warranted
  | 'BUDGET_EXHAUSTED';  // total spend has reached or exceeded total cap

export interface OptimizationDecision {
  campaignId: string;
  trigger: OptimizationTrigger;
  reallocated: boolean;
  skipReason?: SkipReason;
  scores: AdScore[];
  previousAllocation: AdBudgetAllocation[];
  newAllocation: AdBudgetAllocation[] | null;
  decidedAt: Date;
}

// ─── Reallocation ─────────────────────────────────────────────────────────────

/**
 * A single proposed budget change for one ad.
 * The delta is the suggested shift in USD (positive = increase, negative = decrease).
 */
export interface BudgetDelta {
  adId: string;
  adSetId: string;
  currentDailyUsd: number;
  proposedDailyUsd: number;
  deltaUsd: number;
}

// ─── Safety actions ───────────────────────────────────────────────────────────

export type SafetyAction =
  | 'NONE'
  | 'REDUCE_BUDGETS'
  | 'FREEZE_OPTIMIZER'
  | 'PAUSE_ALL_ADS';

export interface BudgetGuardResult {
  campaignId: string;
  pacingStatus: PacingStatus;
  actionTaken: SafetyAction;
  notes: string;
  executedAt: Date;
}
