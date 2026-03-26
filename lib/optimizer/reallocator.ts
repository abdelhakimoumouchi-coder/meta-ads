/**
 * lib/optimizer/reallocator.ts
 *
 * Budget reallocation engine.
 *
 * Takes a set of ad scores and a current budget allocation, and produces a
 * new allocation that:
 *   - Rewards top performers with more budget
 *   - Reduces budget for underperformers conservatively
 *   - Never moves more than MAX_SHIFT_USD per ad in a single cycle
 *   - Always sums to the configured daily target
 *   - Keeps every ad within [MIN_AD_DAILY_BUDGET, MAX_AD_DAILY_BUDGET]
 *   - Ineligible ads (insufficient data) receive their current allocation unchanged
 *
 * The algorithm:
 * 1. Separate eligible and ineligible ads.
 * 2. For eligible ads, compute a score-proportional ideal allocation.
 * 3. Cap each change at MAX_SHIFT_USD (conservative guard).
 * 4. Re-enforce min/max clamps and reconcile to target total.
 * 5. Merge with ineligible ad allocations (held at current budget).
 *
 * All functions are pure — no I/O.
 */

import type { AdScore } from '../../types/optimizer';
import type { AdBudgetAllocation } from '../../types/campaign';
import { distributeByScore, reconcileToTotal } from '../utils/money';
import { clamp, round } from '../utils/math';
import {
  MIN_AD_DAILY_BUDGET,
  MAX_AD_DAILY_BUDGET,
  BASE_DAILY_BUDGET,
} from '../constants/app';
import { MAX_SHIFT_USD } from '../constants/optimizer';
import { enforceAllocationLimits } from '../budget/limits';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReallocationInput {
  scores: AdScore[];
  currentAllocations: AdBudgetAllocation[];
  /** Target total daily spend (defaults to BASE_DAILY_BUDGET). */
  targetDailyUsd?: number;
}

export interface ReallocationResult {
  newAllocations: AdBudgetAllocation[];
  /** Budget deltas per ad (for logging). */
  deltas: Array<{
    adId: string;
    previousUsd: number;
    newUsd: number;
    deltaUsd: number;
  }>;
  /** Total of the new allocation (should be ≈ targetDailyUsd). */
  newTotalUsd: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Look up an ad's current daily budget from the allocations list.
 * Returns the default fallback if not found.
 */
function getCurrentBudget(
  adId: string,
  allocations: AdBudgetAllocation[],
  fallback: number,
): number {
  return allocations.find((a) => a.adId === adId)?.dailyBudgetUsd ?? fallback;
}

/**
 * Look up an ad's adSetId from the allocations list.
 * Returns an empty string if not found (caller should validate).
 */
function getAdSetId(adId: string, allocations: AdBudgetAllocation[]): string {
  return allocations.find((a) => a.adId === adId)?.adSetId ?? '';
}

// ─── Core reallocation logic ──────────────────────────────────────────────────

/**
 * Compute a conservative budget reallocation based on ad scores.
 *
 * Ineligible ads are held at their current budget.
 * Eligible ads receive a score-proportional share of the remaining budget pool,
 * subject to MAX_SHIFT_USD per ad.
 *
 * @param input   Scores, current allocations, and target total.
 * @returns       New allocations with budget deltas for auditing.
 */
export function computeReallocation(input: ReallocationInput): ReallocationResult {
  const targetDailyUsd = input.targetDailyUsd ?? BASE_DAILY_BUDGET;
  const { scores, currentAllocations } = input;

  // Separate eligible and ineligible ads.
  const eligibleScores = scores.filter((s) => s.isEligible);
  const ineligibleScores = scores.filter((s) => !s.isEligible);

  // Ineligible ads hold their current budget (or default).
  const adCount = Math.max(scores.length, 1);
  const defaultBudgetPerAd = Math.max(BASE_DAILY_BUDGET / adCount, MIN_AD_DAILY_BUDGET);
  const ineligibleBudgetTotal = ineligibleScores.reduce((sum, s) => {
    const current = getCurrentBudget(s.adId, currentAllocations, defaultBudgetPerAd);
    return sum + clamp(current, MIN_AD_DAILY_BUDGET, MAX_AD_DAILY_BUDGET);
  }, 0);

  // Budget pool available for eligible ads.
  const eligiblePoolUsd = Math.max(
    0,
    targetDailyUsd - ineligibleBudgetTotal,
  );

  const newAllocations: AdBudgetAllocation[] = [];
  const deltas: ReallocationResult['deltas'] = [];

  // ── Eligible ad reallocation ───────────────────────────────────────────────

  if (eligibleScores.length > 0) {
    // 1. Score-proportional ideal allocation.
    const scoreValues = eligibleScores.map((s) => s.finalScore);
    const proposedBudgets = distributeByScore(
      scoreValues,
      eligiblePoolUsd,
      MIN_AD_DAILY_BUDGET,
      MAX_AD_DAILY_BUDGET,
    );

    // 2. Cap the change per ad at MAX_SHIFT_USD (anti-noise guard).
    const capped = eligibleScores.map((s, i) => {
      const current = getCurrentBudget(
        s.adId,
        currentAllocations,
        eligiblePoolUsd / eligibleScores.length,
      );
      const proposed = proposedBudgets[i] ?? current;
      const delta = proposed - current;
      const cappedDelta = Math.sign(delta) * Math.min(Math.abs(delta), MAX_SHIFT_USD);
      return clamp(round(current + cappedDelta, 2), MIN_AD_DAILY_BUDGET, MAX_AD_DAILY_BUDGET);
    });

    // 3. Reconcile to the eligible pool total after capping.
    const reconciled = reconcileToTotal(
      capped,
      eligiblePoolUsd,
      MIN_AD_DAILY_BUDGET,
      MAX_AD_DAILY_BUDGET,
    );

    // 4. Build allocation objects and record deltas.
    for (let i = 0; i < eligibleScores.length; i++) {
      const score = eligibleScores[i];
      const newBudget = reconciled[i] ?? MIN_AD_DAILY_BUDGET;
      const previousBudget = getCurrentBudget(
        score.adId,
        currentAllocations,
        eligiblePoolUsd / eligibleScores.length,
      );

      newAllocations.push({
        adId: score.adId,
        adSetId: getAdSetId(score.adId, currentAllocations),
        dailyBudgetUsd: newBudget,
      });

      deltas.push({
        adId: score.adId,
        previousUsd: round(previousBudget, 2),
        newUsd: round(newBudget, 2),
        deltaUsd: round(newBudget - previousBudget, 2),
      });
    }
  }

  // ── Ineligible ad allocations (held at current) ────────────────────────────

  for (const score of ineligibleScores) {
    const current = getCurrentBudget(score.adId, currentAllocations, MIN_AD_DAILY_BUDGET);
    const clamped = clamp(current, MIN_AD_DAILY_BUDGET, MAX_AD_DAILY_BUDGET);

    newAllocations.push({
      adId: score.adId,
      adSetId: getAdSetId(score.adId, currentAllocations),
      dailyBudgetUsd: clamped,
    });

    deltas.push({
      adId: score.adId,
      previousUsd: round(current, 2),
      newUsd: round(clamped, 2),
      deltaUsd: 0,
    });
  }

  // ── Final limit enforcement ────────────────────────────────────────────────
  // Re-enforce all hard limits on the combined allocation.
  const enforced = enforceAllocationLimits(newAllocations, targetDailyUsd);

  const newTotalUsd = round(
    enforced.reduce((s, a) => s + a.dailyBudgetUsd, 0),
    2,
  );

  return {
    newAllocations: enforced,
    deltas,
    newTotalUsd,
  };
}
