/**
 * lib/budget/pacing.ts
 *
 * Campaign pacing calculation helpers.
 *
 * Pacing determines whether the campaign is consuming its budget too fast,
 * too slow, or on track relative to the linear daily target.
 *
 * All functions are pure — they accept explicit inputs and return values
 * without performing any I/O.  This makes them straightforward to unit test.
 */

import {
  TOTAL_CAMPAIGN_BUDGET,
  CAMPAIGN_DURATION_DAYS,
  OVERSPEND_BUFFER_PERCENT,
} from '../constants/app';
import {
  PACING_UNDER_THRESHOLD,
  PACING_DANGER_THRESHOLD,
} from '../constants/optimizer';
import { expectedSpend, maxAllowedSpend } from '../utils/money';
import { elapsedDays, campaignDaysRemaining } from '../utils/dates';
import { round, safeDivide } from '../utils/math';
import type { PacingState, PacingStatus } from '../../types/optimizer';

// ─── Core pacing calculation ──────────────────────────────────────────────────

/**
 * Determines the pacing state by comparing actual spend against the linear
 * expected spend at the current moment in the campaign.
 *
 * The "expected" spend model is linear:
 *   expected = (elapsed_days / total_days) × total_budget
 *
 * State boundaries:
 *   actual < 0.85 × expected  → UNDER_PACING
 *   actual ≤ 1.08 × expected  → ON_TRACK
 *   actual ≤ 1.15 × expected  → OVER_PACING
 *   actual > 1.15 × expected  → DANGER
 *
 * @param totalSpentUsd     Total USD spend recorded so far.
 * @param campaignStartDate Date when the campaign started (or should have started).
 * @param now               Current timestamp (injectable for testing).
 * @param totalBudget       Campaign total budget in USD.
 * @param durationDays      Campaign duration in days.
 * @param bufferPct         Allowed overspend buffer percentage.
 */
export function computePacingStatus(
  totalSpentUsd: number,
  campaignStartDate: Date,
  now: Date = new Date(),
  totalBudget: number = TOTAL_CAMPAIGN_BUDGET,
  durationDays: number = CAMPAIGN_DURATION_DAYS,
  bufferPct: number = OVERSPEND_BUFFER_PERCENT,
): PacingStatus {
  const elapsed = elapsedDays(campaignStartDate, now);
  const expected = expectedSpend(totalBudget, durationDays, elapsed);
  const remaining = Math.max(0, totalBudget - totalSpentUsd);
  const daysLeft = campaignDaysRemaining(campaignStartDate, now, durationDays);

  // Deviation as a fraction of expected spend.
  // Positive = over-spending, negative = under-spending.
  const deviationFraction = expected > 0
    ? safeDivide(totalSpentUsd - expected, expected)
    : 0;

  const state = classifyPacingState(
    totalSpentUsd,
    expected,
    bufferPct,
  );

  return {
    state,
    totalSpentUsd: round(totalSpentUsd, 2),
    expectedSpendUsd: round(expected, 2),
    deviationFraction: round(deviationFraction, 4),
    remainingBudgetUsd: round(remaining, 2),
    daysRemaining: round(daysLeft, 2),
    computedAt: now,
  };
}

/**
 * Pure classifier for pacing state.
 * Exported separately so it can be tested without date arithmetic.
 *
 * @param actualSpend   Total USD spent so far.
 * @param expectedSpend Expected spend at this point in time.
 * @param bufferPct     Allowed overspend percentage (e.g. 8 = 8 %).
 */
export function classifyPacingState(
  actualSpend: number,
  expectedSpend: number,
  bufferPct: number = OVERSPEND_BUFFER_PERCENT,
): PacingState {
  // Edge case: if expected is 0 (campaign just started), default to ON_TRACK
  // unless there is already meaningful spend.
  if (expectedSpend <= 0) {
    return actualSpend > 1 ? 'OVER_PACING' : 'ON_TRACK';
  }

  const ratio = safeDivide(actualSpend, expectedSpend);

  // DANGER threshold is driven by bufferPct + a hard safety margin.
  const dangerThreshold = PACING_DANGER_THRESHOLD;
  // OVER_PACING threshold matches the configured overspend buffer.
  const overThreshold = 1 + bufferPct / 100;

  if (ratio > dangerThreshold) return 'DANGER';
  if (ratio > overThreshold) return 'OVER_PACING';
  if (ratio < PACING_UNDER_THRESHOLD) return 'UNDER_PACING';
  return 'ON_TRACK';
}

// ─── Derived helpers ──────────────────────────────────────────────────────────

/**
 * Returns the maximum allowed cumulative spend right now, based on the
 * linear expectation + configured overspend buffer.
 *
 * Using `maxAllowedSpend` from utils/money for the calculation.
 */
export function currentMaxAllowedSpend(
  campaignStartDate: Date,
  now: Date = new Date(),
  totalBudget: number = TOTAL_CAMPAIGN_BUDGET,
  durationDays: number = CAMPAIGN_DURATION_DAYS,
  bufferPct: number = OVERSPEND_BUFFER_PERCENT,
): number {
  const elapsed = elapsedDays(campaignStartDate, now);
  return round(
    maxAllowedSpend(totalBudget, durationDays, elapsed, bufferPct),
    2,
  );
}

/**
 * Returns true when the current spend is within the acceptable pacing envelope
 * (ON_TRACK or UNDER_PACING — over-pacing is handled separately).
 */
export function isOnPace(status: PacingStatus): boolean {
  return status.state === 'ON_TRACK' || status.state === 'UNDER_PACING';
}

/**
 * Returns true when immediate safety action is required.
 */
export function isDangerPacing(status: PacingStatus): boolean {
  return status.state === 'DANGER';
}

/**
 * Computes the recommended daily budget target for the remaining campaign days.
 *
 * Formula: remaining_budget / days_remaining
 * Clamps to [0, total_daily_budget] so the result is always actionable.
 *
 * @param status          Current pacing status.
 * @param maxDailyBudget  Configured max total daily budget (USD).
 */
export function recommendedDailyBudget(
  status: PacingStatus,
  maxDailyBudget: number = TOTAL_CAMPAIGN_BUDGET / CAMPAIGN_DURATION_DAYS,
): number {
  if (status.daysRemaining <= 0) return 0;
  const recommended = safeDivide(status.remainingBudgetUsd, status.daysRemaining);
  return round(Math.min(recommended, maxDailyBudget), 2);
}
