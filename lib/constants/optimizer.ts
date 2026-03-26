/**
 * Optimizer rule constants.
 *
 * These constants encode the hard constraints that govern budget reallocation.
 * All values are authoritative business rules; never silently change them.
 * If a rule needs to be environment-configurable, add it to lib/constants/app.ts.
 */

import {
  BASE_DAILY_BUDGET,
  CAMPAIGN_DURATION_DAYS,
  MAX_SINGLE_SHIFT_PERCENT,
  MIN_AD_DAILY_BUDGET,
  MAX_AD_DAILY_BUDGET,
  MIN_REALLOCATION_INTERVAL_HOURS,
  MIN_SPEND_BEFORE_DECISION,
  OVERSPEND_BUFFER_PERCENT,
  TOTAL_CAMPAIGN_BUDGET,
} from './app';

// Re-export from app so callers only need to import from one place.
export {
  BASE_DAILY_BUDGET,
  CAMPAIGN_DURATION_DAYS,
  MAX_SINGLE_SHIFT_PERCENT,
  MIN_AD_DAILY_BUDGET,
  MAX_AD_DAILY_BUDGET,
  MIN_REALLOCATION_INTERVAL_HOURS,
  MIN_SPEND_BEFORE_DECISION,
  OVERSPEND_BUFFER_PERCENT,
  TOTAL_CAMPAIGN_BUDGET,
};

// ─── Derived budget constants ─────────────────────────────────────────────────

/**
 * Maximum absolute USD that a single ad's daily budget can shift in one cycle.
 * Computed from MAX_SINGLE_SHIFT_PERCENT of BASE_DAILY_BUDGET.
 * Example: 25 % of 30 = 7.5 USD.
 */
export const MAX_SHIFT_USD = (BASE_DAILY_BUDGET * MAX_SINGLE_SHIFT_PERCENT) / 100;

// ─── Pacing thresholds ────────────────────────────────────────────────────────

/**
 * Fraction of expected spend below which the campaign is considered UNDER_PACING.
 * Example: actual = 0.85 × expected → UNDER_PACING.
 */
export const PACING_UNDER_THRESHOLD = 0.85;

/**
 * Fraction of expected spend above which the campaign is considered OVER_PACING.
 */
export const PACING_OVER_THRESHOLD = 1.08; // matches OVERSPEND_BUFFER_PERCENT

/**
 * Fraction of expected spend above which the campaign is in DANGER state.
 * A DANGER state immediately triggers safety actions.
 */
export const PACING_DANGER_THRESHOLD = 1.15;

// ─── Optimizer eligibility ────────────────────────────────────────────────────

/**
 * Minimum number of impressions an ad must have before its performance
 * can influence reallocation.  Protects against statistical noise.
 */
export const MIN_IMPRESSIONS_BEFORE_DECISION = 100;

/**
 * Minimum fraction of active ads that must be eligible before the optimizer
 * attempts a reallocation.  If too few ads qualify, the run is skipped.
 */
export const MIN_ELIGIBLE_ADS_FRACTION = 0.5; // at least half must be eligible

// ─── Score similarity threshold ──────────────────────────────────────────────

/**
 * If the highest and lowest final scores differ by less than this value,
 * the optimizer considers performance "too close to call" and skips reallocation.
 * Prevents constant micro-adjustments that add noise.
 */
export const MIN_SCORE_SPREAD_FOR_REALLOCATION = 0.08;

// ─── Budget guard thresholds ──────────────────────────────────────────────────

/**
 * When in OVER_PACING state, reduce each ad's daily budget by this fraction.
 */
export const BUDGET_GUARD_REDUCTION_FRACTION = 0.10; // 10 %

/**
 * When in DANGER state, reduce each ad's daily budget by this fraction.
 */
export const BUDGET_GUARD_DANGER_REDUCTION_FRACTION = 0.25; // 25 %
