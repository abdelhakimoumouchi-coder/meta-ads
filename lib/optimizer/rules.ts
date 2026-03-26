/**
 * lib/optimizer/rules.ts
 *
 * Optimization guard rules.
 *
 * These functions determine whether the optimizer is ALLOWED to run at all
 * before any scoring or reallocation logic is attempted.
 *
 * Guard order (all must pass to proceed):
 * 1. 48-hour cooldown since last reallocation.
 * 2. Budget not exhausted.
 * 3. Campaign not ended.
 * 4. Pacing state is not DANGER (budget guard has priority when in danger).
 * 5. At least a minimum fraction of ads are eligible (have enough data).
 *
 * All guard functions are pure — they accept their dependencies explicitly
 * and return typed results without performing I/O.
 */

import type { AdScore, PacingStatus, SkipReason } from '../../types/optimizer';
import { isOptimizationAllowed, isCampaignOver } from '../utils/dates';
import {
  MIN_REALLOCATION_INTERVAL_HOURS,
  TOTAL_CAMPAIGN_BUDGET,
  CAMPAIGN_DURATION_DAYS,
} from '../constants/app';
import {
  MIN_ELIGIBLE_ADS_FRACTION,
  MIN_SCORE_SPREAD_FOR_REALLOCATION,
} from '../constants/optimizer';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GuardCheckResult {
  allowed: boolean;
  skipReason?: SkipReason;
  message: string;
}

// ─── Individual guard checks ──────────────────────────────────────────────────

/**
 * Guard 1: 48-hour cooldown.
 *
 * Returns not-allowed if a reallocation occurred within the configured
 * minimum interval.
 */
export function checkCooldownGuard(
  lastReallocatedAt: Date | null,
  now: Date = new Date(),
  minIntervalHours: number = MIN_REALLOCATION_INTERVAL_HOURS,
): GuardCheckResult {
  const allowed = isOptimizationAllowed(lastReallocatedAt, now, minIntervalHours);
  if (allowed) {
    return { allowed: true, message: 'Cooldown guard passed.' };
  }

  const hoursAgo = lastReallocatedAt
    ? Math.round((now.getTime() - lastReallocatedAt.getTime()) / 3_600_000)
    : 0;

  return {
    allowed: false,
    skipReason: 'TOO_SOON',
    message: `Last reallocation was ${hoursAgo}h ago (minimum: ${minIntervalHours}h). Skipping.`,
  };
}

/**
 * Guard 2: Budget not exhausted.
 *
 * Returns not-allowed if total spend has reached or exceeded the campaign cap.
 */
export function checkBudgetExhaustedGuard(
  totalSpentUsd: number,
  totalBudget: number = TOTAL_CAMPAIGN_BUDGET,
): GuardCheckResult {
  if (totalSpentUsd >= totalBudget) {
    return {
      allowed: false,
      skipReason: 'BUDGET_EXHAUSTED',
      message: `Total spend $${totalSpentUsd.toFixed(2)} has reached campaign budget $${totalBudget}. Skipping.`,
    };
  }
  return { allowed: true, message: 'Budget guard passed.' };
}

/**
 * Guard 3: Campaign not over.
 *
 * Returns not-allowed if the campaign has already ended.
 */
export function checkCampaignActiveGuard(
  campaignStartDate: Date,
  now: Date = new Date(),
  durationDays: number = CAMPAIGN_DURATION_DAYS,
): GuardCheckResult {
  if (isCampaignOver(campaignStartDate, now, durationDays)) {
    return {
      allowed: false,
      skipReason: 'BUDGET_EXHAUSTED', // campaign over is treated the same way
      message: 'Campaign has ended. Skipping optimization.',
    };
  }
  return { allowed: true, message: 'Campaign is still active.' };
}

/**
 * Guard 4: Pacing state is not DANGER.
 *
 * When the budget guard is in DANGER state, it takes full control and the
 * optimizer must stand down to avoid amplifying the problem.
 */
export function checkPacingGuard(
  pacingStatus: PacingStatus,
): GuardCheckResult {
  if (pacingStatus.state === 'DANGER') {
    return {
      allowed: false,
      skipReason: 'DANGER_PACING',
      message: `Pacing state is DANGER (spend ratio: ${(pacingStatus.deviationFraction + 1).toFixed(2)}×). Optimizer frozen.`,
    };
  }
  return { allowed: true, message: `Pacing state is ${pacingStatus.state}.` };
}

/**
 * Guard 5: Sufficient data for a meaningful decision.
 *
 * Requires at least MIN_ELIGIBLE_ADS_FRACTION of ads to be eligible.
 * If too few ads have enough data, a reallocation would be based on noise.
 */
export function checkDataSufficiencyGuard(
  scores: AdScore[],
  minEligibleFraction: number = MIN_ELIGIBLE_ADS_FRACTION,
): GuardCheckResult {
  if (scores.length === 0) {
    return {
      allowed: false,
      skipReason: 'INSUFFICIENT_DATA',
      message: 'No ad scores available.',
    };
  }

  const eligibleCount = scores.filter((s) => s.isEligible).length;
  const eligibleFraction = eligibleCount / scores.length;

  if (eligibleFraction < minEligibleFraction) {
    return {
      allowed: false,
      skipReason: 'INSUFFICIENT_DATA',
      message:
        `Only ${eligibleCount}/${scores.length} ads are eligible (minimum: ${Math.ceil(scores.length * minEligibleFraction)}). ` +
        `Insufficient data to make a reliable decision.`,
    };
  }

  return {
    allowed: true,
    message: `${eligibleCount}/${scores.length} ads are eligible.`,
  };
}

/**
 * Guard 6: Score spread is large enough to warrant reallocation.
 *
 * If all ads have nearly identical scores, there's no meaningful signal to
 * act on — reallocating would just add noise.
 */
export function checkScoreSpreadGuard(
  scores: AdScore[],
  minSpread: number = MIN_SCORE_SPREAD_FOR_REALLOCATION,
): GuardCheckResult {
  const eligible = scores.filter((s) => s.isEligible);
  if (eligible.length < 2) {
    // Can't assess spread with fewer than 2 eligible ads; allow it.
    return { allowed: true, message: 'Too few eligible ads to assess score spread.' };
  }

  const finalScores = eligible.map((s) => s.finalScore);
  const maxScore = Math.max(...finalScores);
  const minScore = Math.min(...finalScores);
  const spread = maxScore - minScore;

  if (spread < minSpread) {
    return {
      allowed: false,
      skipReason: 'NO_CHANGE_NEEDED',
      message: `Score spread (${spread.toFixed(3)}) is below threshold (${minSpread}). No meaningful difference between ads.`,
    };
  }

  return {
    allowed: true,
    message: `Score spread is ${spread.toFixed(3)} (threshold: ${minSpread}).`,
  };
}

// ─── Composite guard ──────────────────────────────────────────────────────────

/**
 * Run all applicable guards and return the first failure, or an allowed result.
 *
 * Guards are evaluated in priority order:
 * cooldown → budget_exhausted → campaign_active → pacing → data_sufficiency → score_spread
 *
 * @param params  All the context required for guard evaluation.
 */
export function runAllGuards(params: {
  lastReallocatedAt: Date | null;
  totalSpentUsd: number;
  campaignStartDate: Date;
  pacingStatus: PacingStatus;
  scores: AdScore[];
  now?: Date;
}): GuardCheckResult {
  const now = params.now ?? new Date();

  const checks: GuardCheckResult[] = [
    checkCooldownGuard(params.lastReallocatedAt, now),
    checkBudgetExhaustedGuard(params.totalSpentUsd),
    checkCampaignActiveGuard(params.campaignStartDate, now),
    checkPacingGuard(params.pacingStatus),
    checkDataSufficiencyGuard(params.scores),
    checkScoreSpreadGuard(params.scores),
  ];

  for (const check of checks) {
    if (!check.allowed) return check;
  }

  return { allowed: true, message: 'All guards passed. Proceeding with reallocation.' };
}
