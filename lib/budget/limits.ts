/**
 * lib/budget/limits.ts
 *
 * Budget limit enforcement helpers.
 *
 * These pure functions answer questions like:
 * - "Is this allocation within the hard budget cap?"
 * - "Are all per-ad budgets within the min/max per-ad constraints?"
 * - "What is the maximum we can spend today given remaining budget?"
 *
 * They contain no I/O — all inputs are passed explicitly.
 */

import { clamp, round } from '../utils/math';
import { reconcileToTotal } from '../utils/money';
import {
  TOTAL_CAMPAIGN_BUDGET,
  MIN_AD_DAILY_BUDGET,
  MAX_AD_DAILY_BUDGET,
  BASE_DAILY_BUDGET,
} from '../constants/app';
import type { AdBudgetAllocation } from '../../types/campaign';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BudgetLimitCheckResult {
  /** True if all limits are respected. */
  valid: boolean;
  /** Human-readable violations (empty if valid). */
  violations: string[];
}

// ─── Per-allocation checks ────────────────────────────────────────────────────

/**
 * Checks that a proposed daily budget allocation satisfies all hard constraints.
 *
 * Hard constraints checked:
 * 1. Each ad's daily budget ≥ MIN_AD_DAILY_BUDGET.
 * 2. Each ad's daily budget ≤ MAX_AD_DAILY_BUDGET.
 * 3. Sum of all ad budgets ≤ maxDailyUsd (defaults to BASE_DAILY_BUDGET).
 * 4. Sum of all ad budgets is > 0.
 *
 * @param allocations   Proposed per-ad daily budgets in USD.
 * @param maxDailyUsd   Upper bound for the total daily spend (default: BASE_DAILY_BUDGET).
 */
export function checkAllocationLimits(
  allocations: AdBudgetAllocation[],
  maxDailyUsd: number = BASE_DAILY_BUDGET,
): BudgetLimitCheckResult {
  const violations: string[] = [];

  if (allocations.length === 0) {
    violations.push('Allocation list is empty.');
    return { valid: false, violations };
  }

  let total = 0;

  for (const alloc of allocations) {
    if (alloc.dailyBudgetUsd < MIN_AD_DAILY_BUDGET) {
      violations.push(
        `Ad ${alloc.adId}: daily budget $${alloc.dailyBudgetUsd} is below minimum $${MIN_AD_DAILY_BUDGET}.`,
      );
    }
    if (alloc.dailyBudgetUsd > MAX_AD_DAILY_BUDGET) {
      violations.push(
        `Ad ${alloc.adId}: daily budget $${alloc.dailyBudgetUsd} exceeds maximum $${MAX_AD_DAILY_BUDGET}.`,
      );
    }
    total += alloc.dailyBudgetUsd;
  }

  if (total <= 0) {
    violations.push('Total daily budget must be greater than zero.');
  }

  if (total > maxDailyUsd + 0.01) {
    violations.push(
      `Total daily budget $${round(total, 2)} exceeds daily cap $${maxDailyUsd}.`,
    );
  }

  return { valid: violations.length === 0, violations };
}

// ─── Campaign total budget check ──────────────────────────────────────────────

/**
 * Returns true if adding `projectedDailySpend` more for the remaining
 * `daysRemaining` days would breach the campaign's total budget cap.
 *
 * Use this BEFORE applying a reallocation to make sure the new allocation
 * is safe for the rest of the campaign.
 *
 * @param totalSpentUsd       Total spend so far (USD).
 * @param projectedDailySpend Proposed daily spend (USD) to evaluate.
 * @param daysRemaining       Fractional days left in the campaign.
 * @param totalBudget         Hard cap for the full campaign (USD).
 */
export function wouldExceedTotalBudget(
  totalSpentUsd: number,
  projectedDailySpend: number,
  daysRemaining: number,
  totalBudget: number = TOTAL_CAMPAIGN_BUDGET,
): boolean {
  if (daysRemaining <= 0) return false;
  const projectedTotal = totalSpentUsd + projectedDailySpend * daysRemaining;
  return projectedTotal > totalBudget;
}

/**
 * Calculate the maximum safe daily spend given what has already been spent
 * and how many days are remaining.
 *
 * Returns 0 if the budget is already fully consumed.
 *
 * @param totalSpentUsd   Total spend so far (USD).
 * @param daysRemaining   Fractional days remaining (may be < 1 on the last day).
 * @param totalBudget     Campaign's total budget cap (USD).
 */
export function maxSafeDailySpend(
  totalSpentUsd: number,
  daysRemaining: number,
  totalBudget: number = TOTAL_CAMPAIGN_BUDGET,
): number {
  const remainingBudget = Math.max(0, totalBudget - totalSpentUsd);
  if (daysRemaining <= 0 || remainingBudget <= 0) return 0;
  return round(remainingBudget / daysRemaining, 2);
}

// ─── Allocation enforcement ───────────────────────────────────────────────────

/**
 * Clamps each per-ad budget to [MIN_AD_DAILY_BUDGET, MAX_AD_DAILY_BUDGET] and
 * reconciles the total to `targetDailyUsd`.
 *
 * This is the authoritative enforcement step applied after every reallocation
 * computation and before writing any values to the Meta API.
 *
 * @param allocations      Raw proposed allocations.
 * @param targetDailyUsd   The total daily spend target (defaults to BASE_DAILY_BUDGET).
 */
export function enforceAllocationLimits(
  allocations: AdBudgetAllocation[],
  targetDailyUsd: number = BASE_DAILY_BUDGET,
): AdBudgetAllocation[] {
  if (allocations.length === 0) return [];

  const budgets = allocations.map((a) => a.dailyBudgetUsd);

  const clamped = budgets.map((b) =>
    clamp(b, MIN_AD_DAILY_BUDGET, MAX_AD_DAILY_BUDGET),
  );

  const reconciled = reconcileToTotal(
    clamped,
    targetDailyUsd,
    MIN_AD_DAILY_BUDGET,
    MAX_AD_DAILY_BUDGET,
  );

  return allocations.map((alloc, i) => ({
    ...alloc,
    dailyBudgetUsd: reconciled[i] ?? alloc.dailyBudgetUsd,
  }));
}

/**
 * Applies a global scaling factor to all ad budgets, useful when the pacing
 * engine needs to reduce overall daily spend without changing relative splits.
 *
 * After scaling, limits are re-enforced.
 *
 * @param allocations   Current allocations.
 * @param scaleFactor   Multiplier (e.g. 0.9 = 10 % reduction).
 */
export function scaleAllAllocations(
  allocations: AdBudgetAllocation[],
  scaleFactor: number,
): AdBudgetAllocation[] {
  if (allocations.length === 0) return [];

  const scaled = allocations.map((a) => ({
    ...a,
    dailyBudgetUsd: clamp(
      round(a.dailyBudgetUsd * scaleFactor, 2),
      MIN_AD_DAILY_BUDGET,
      MAX_AD_DAILY_BUDGET,
    ),
  }));

  // Compute the actual new total and reconcile if needed.
  const newTotal = scaled.reduce((s, a) => s + a.dailyBudgetUsd, 0);
  return enforceAllocationLimits(scaled, newTotal);
}
