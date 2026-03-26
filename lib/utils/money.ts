/**
 * Money / budget arithmetic helpers.
 *
 * All amounts are in USD unless the function name explicitly mentions "cents".
 * All functions are pure and never throw on finite numeric input.
 *
 * Budget safety rule: always clamp results to configured min/max per-ad budgets.
 */

import { clamp, round, safeDivide } from './math';

// ─── Cent / dollar conversion ─────────────────────────────────────────────────

/**
 * Converts USD cents (integer) to a USD dollar amount (float).
 * E.g. `centsToUsd(3050)` → `30.50`.
 */
export function centsToUsd(cents: number): number {
  return cents / 100;
}

/**
 * Converts a USD dollar amount to cents, rounded to the nearest cent.
 * E.g. `usdToCents(30.5)` → `3050`.
 */
export function usdToCents(usd: number): number {
  return Math.round(usd * 100);
}

// ─── Budget distribution ──────────────────────────────────────────────────────

/**
 * Distributes `totalBudget` USD across `count` ads equally.
 * Rounds each share down and assigns the remaining cents to the first ad.
 * This ensures the sum is always exactly `totalBudget` (within floating-point precision).
 *
 * Returns an array of `count` USD amounts.
 */
export function distributeEvenly(totalBudget: number, count: number): number[] {
  if (count <= 0) return [];
  const share = Math.floor((totalBudget / count) * 100) / 100; // floor to 2dp
  const remainder = round(totalBudget - share * count, 2);
  const result = Array(count).fill(share) as number[];
  if (result.length > 0) result[0] = round(result[0] + remainder, 2);
  return result;
}

/**
 * Redistributes a total daily budget across ads proportionally to their scores.
 *
 * @param scores    Array of relative weights (e.g. finalScore per ad). Order matches `adIds`.
 * @param total     Total USD to distribute.
 * @param minBudget Minimum USD per ad (hard floor).
 * @param maxBudget Maximum USD per ad (hard ceiling).
 *
 * Returns an array of USD amounts in the same order as `scores`.
 * The sum may differ from `total` by up to 0.01 USD due to rounding.
 */
export function distributeByScore(
  scores: number[],
  total: number,
  minBudget: number,
  maxBudget: number
): number[] {
  if (scores.length === 0) return [];

  const totalScore = scores.reduce((s, v) => s + Math.max(0, v), 0);

  // If all scores are 0 fall back to even distribution
  if (totalScore === 0) {
    return distributeEvenly(total, scores.length).map((v) =>
      clamp(v, minBudget, maxBudget)
    );
  }

  // Proportional raw allocation
  const raw = scores.map((s) => safeDivide(Math.max(0, s), totalScore) * total);

  // Apply min/max clamps
  const clamped = raw.map((v) => clamp(v, minBudget, maxBudget));

  // Adjust to preserve total after clamping via a simple iterative correction
  return reconcileToTotal(clamped, total, minBudget, maxBudget);
}

/**
 * Adjusts an array of budget allocations so they sum to `target`,
 * respecting `min` and `max` per-item bounds.
 *
 * Uses a proportional adjustment strategy:
 * 1. Identify ads that are not at their clamp limits.
 * 2. Distribute the surplus/deficit proportionally among them.
 *
 * This is intentionally conservative — it will not violate min/max even if
 * the constraints make it impossible to hit the exact target.
 */
export function reconcileToTotal(
  budgets: number[],
  target: number,
  min: number,
  max: number
): number[] {
  if (budgets.length === 0) return [];

  let result = budgets.map((b) => clamp(b, min, max));
  const diff = round(target - result.reduce((s, v) => s + v, 0), 4);

  if (Math.abs(diff) < 0.01) return result.map((v) => round(v, 2));

  // Distribute diff among items that have headroom
  const isIncreasing = diff > 0;

  const eligibleIndices = result
    .map((_, i) => i)
    .filter((i) => (isIncreasing ? result[i] < max : result[i] > min));

  if (eligibleIndices.length === 0) return result.map((v) => round(v, 2));

  const perItem = diff / eligibleIndices.length;
  for (const i of eligibleIndices) {
    result[i] = clamp(round(result[i] + perItem, 2), min, max);
  }

  return result.map((v) => round(v, 2));
}

// ─── Pacing helpers ───────────────────────────────────────────────────────────

/**
 * Calculates the theoretical expected spend given:
 * - `totalBudget` : total campaign budget in USD
 * - `totalDays`   : total campaign duration in days
 * - `elapsedDays` : days elapsed since campaign start (fractional)
 *
 * Returns the expected cumulative spend in USD.
 */
export function expectedSpend(
  totalBudget: number,
  totalDays: number,
  elapsedDays: number
): number {
  if (totalDays <= 0) return totalBudget;
  return safeDivide(elapsedDays, totalDays) * totalBudget;
}

/**
 * Calculates the remaining daily budget target given:
 * - `remainingBudget` : unspent budget in USD
 * - `remainingDays`   : fractional days remaining
 *
 * Returns the recommended daily spend to exhaust the remaining budget on time.
 */
export function idealDailyRemaining(
  remainingBudget: number,
  remainingDays: number
): number {
  if (remainingDays <= 0) return remainingBudget;
  return safeDivide(remainingBudget, remainingDays);
}

/**
 * Returns the maximum allowable cumulative spend at the current moment,
 * including the configured overspend buffer.
 *
 * E.g. with budget=180, bufferPct=8, elapsed=3, total=6:
 *   expected = 90, max = 90 * 1.08 = 97.2
 */
export function maxAllowedSpend(
  totalBudget: number,
  totalDays: number,
  elapsedDays: number,
  bufferPct: number
): number {
  const expected = expectedSpend(totalBudget, totalDays, elapsedDays);
  return expected * (1 + bufferPct / 100);
}
