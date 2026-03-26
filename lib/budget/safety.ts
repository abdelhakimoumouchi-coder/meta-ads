/**
 * lib/budget/safety.ts
 *
 * Budget Safety Engine.
 *
 * This module is the guardian of the campaign's total budget.  It evaluates
 * the current pacing state and, when necessary, takes protective actions:
 *
 * 1. NONE          – Everything is fine; no action needed.
 * 2. REDUCE_BUDGETS – Over-pacing; reduce per-ad daily budgets proportionally.
 * 3. FREEZE_OPTIMIZER – Danger pacing; prevent the optimizer from making any
 *                       changes until pacing recovers.
 * 4. PAUSE_ALL_ADS  – Budget exhausted or campaign ended; pause all delivery.
 *
 * This module coordinates with:
 *   - lib/budget/pacing.ts   (classify pacing state)
 *   - lib/budget/limits.ts   (apply and validate new allocations)
 *   - lib/meta/budgets.ts    (write budget changes to the Meta API)
 *   - lib/db/queries.ts      (persist guard run to DB)
 */

import type { AdBudgetAllocation } from '../../types/campaign';
import type { BudgetGuardResult, PacingStatus, SafetyAction } from '../../types/optimizer';
import { computePacingStatus, isDangerPacing, isOnPace } from './pacing';
import { scaleAllAllocations, maxSafeDailySpend } from './limits';
import { batchUpdateAdSetBudgets, usdToCents } from '../meta/budgets';
import { createBudgetGuardRun, getTotalSpendCents } from '../db/queries';
import { centsToUsd } from "../utils/money";
import { round } from "../utils/math";
import { createLogger } from '../logs/logger';
import {
  TOTAL_CAMPAIGN_BUDGET,
  CAMPAIGN_DURATION_DAYS,
  AUTO_PAUSE_IF_BUDGET_REACHED,
  AUTO_PAUSE_IF_CAMPAIGN_END_REACHED,
  OVERSPEND_BUFFER_PERCENT,
  BASE_DAILY_BUDGET,
} from '../constants/app';
import {
  BUDGET_GUARD_REDUCTION_FRACTION,
  BUDGET_GUARD_DANGER_REDUCTION_FRACTION,
} from '../constants/optimizer';
import { isCampaignOver } from '../utils/dates';

const logger = createLogger('budget:safety');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BudgetGuardInput {
  campaignId: string;
  campaignDbId: string;
  campaignStartDate: Date;
  currentAllocations: AdBudgetAllocation[];
  now?: Date;
}

// ─── Pause helpers ────────────────────────────────────────────────────────────

/**
 * Pause all ads by setting their budgets to the minimum allowed value.
 * This is a Meta-safe way to effectively stop spend without deleting ad sets.
 *
 * In a real production system you might also call the Meta API to set the
 * ad set status to PAUSED.  For now we reduce budgets to the floor, which
 * stops competitive delivery without requiring an extra API call.
 */
async function applyPauseAllocation(
  allocations: AdBudgetAllocation[],
): Promise<void> {
  if (allocations.length === 0) return;

  // Set all to minimum (but > 0 so Meta doesn't reject the update).
  const updates = allocations.map((a) => ({
    adSetId: a.adSetId,
    cents: usdToCents(1), // $1 minimum — stops meaningful delivery
  }));

  const results = await batchUpdateAdSetBudgets(updates);
  const failures = Array.from(results.entries()).filter(([, ok]) => !ok);
  if (failures.length > 0) {
    await logger.warn('Some ad set pause updates failed', {
      failedAdSets: failures.map(([id]) => id),
    });
  }
}

/**
 * Apply reduced budgets to the Meta API.
 */
async function applyReducedAllocations(
  allocations: AdBudgetAllocation[],
): Promise<void> {
  if (allocations.length === 0) return;

  const updates = allocations.map((a) => ({
    adSetId: a.adSetId,
    cents: usdToCents(a.dailyBudgetUsd),
  }));

  const results = await batchUpdateAdSetBudgets(updates);
  const failures = Array.from(results.entries()).filter(([, ok]) => !ok);
  if (failures.length > 0) {
    await logger.warn('Some budget reduction updates failed', {
      failedAdSets: failures.map(([id]) => id),
    });
  }
}

// ─── Budget reduction helper ──────────────────────────────────────────────────

/**
 * Reduce all ad budgets by `reductionFraction`, capped by the safe daily
 * spend derived from the remaining budget.
 *
 * Extracted so both FREEZE_OPTIMIZER and REDUCE_BUDGETS cases can call it
 * explicitly without fall-through logic.
 *
 * @returns The updated allocations and a human-readable note suffix.
 */
async function applyBudgetReduction(
  currentAllocations: AdBudgetAllocation[],
  campaignId: string,
  totalSpentUsd: number,
  daysRemaining: number,
  reductionFraction: number,
  action: SafetyAction,
): Promise<{ allocations: AdBudgetAllocation[]; noteSuffix: string }> {
  const scaleFactor = 1 - reductionFraction;

  // Also consider the max safe daily spend given remaining budget.
  const safeDaily = maxSafeDailySpend(
    totalSpentUsd,
    daysRemaining,
    TOTAL_CAMPAIGN_BUDGET,
  );

  const currentTotal = currentAllocations.reduce(
    (s, a) => s + a.dailyBudgetUsd,
    0,
  );
  const scaledTotal = round(currentTotal * scaleFactor, 2);
  const targetTotal = Math.min(
    scaledTotal,
    safeDaily > 0 ? safeDaily : BASE_DAILY_BUDGET,
  );

  const allocations = scaleAllAllocations(
    currentAllocations,
    targetTotal / (currentTotal || BASE_DAILY_BUDGET),
  );

  await applyReducedAllocations(allocations);

  const newTotal = round(allocations.reduce((s, a) => s + a.dailyBudgetUsd, 0), 2);

  await logger.warn('Budget guard reduced ad spend', {
    campaignId,
    action,
    reductionFraction,
    previousTotal: currentTotal,
    newTotal,
  });

  const noteSuffix =
    ` Budgets reduced by ${Math.round(reductionFraction * 100)}%.` +
    ` New total: $${newTotal}.`;

  return { allocations, noteSuffix };
}

// ─── Decision logic ───────────────────────────────────────────────────────────

/**
 * Decide what safety action to take based on pacing status.
 *
 * Priority order:
 * 1. Budget exhausted → PAUSE (highest priority)
 * 2. Campaign ended   → PAUSE (if configured)
 * 3. DANGER pacing    → FREEZE_OPTIMIZER + REDUCE_BUDGETS
 * 4. OVER_PACING      → REDUCE_BUDGETS
 * 5. Otherwise        → NONE
 */
export function decideSafetyAction(
  pacingStatus: PacingStatus,
  campaignStartDate: Date,
  now: Date = new Date(),
  totalBudget: number = TOTAL_CAMPAIGN_BUDGET,
  durationDays: number = CAMPAIGN_DURATION_DAYS,
): SafetyAction {
  // Budget fully consumed.
  if (pacingStatus.remainingBudgetUsd <= 0 && AUTO_PAUSE_IF_BUDGET_REACHED) {
    return 'PAUSE_ALL_ADS';
  }

  // Campaign end date reached.
  if (
    AUTO_PAUSE_IF_CAMPAIGN_END_REACHED &&
    isCampaignOver(campaignStartDate, now, durationDays)
  ) {
    return 'PAUSE_ALL_ADS';
  }

  // Danger — critically over-paced.
  if (isDangerPacing(pacingStatus)) {
    return 'FREEZE_OPTIMIZER'; // caller will also reduce budgets
  }

  // Over-pacing — reduce budgets conservatively.
  if (pacingStatus.state === 'OVER_PACING') {
    return 'REDUCE_BUDGETS';
  }

  return 'NONE';
}

// ─── Main safety engine entry point ──────────────────────────────────────────

/**
 * Run the budget safety engine for the given campaign.
 *
 * Steps:
 * 1. Load total spend from the DB.
 * 2. Compute pacing status.
 * 3. Decide action.
 * 4. Execute the action (may call Meta API).
 * 5. Persist the guard run to the DB.
 * 6. Return the result (for logging / cron route response).
 */
export async function runBudgetGuard(
  input: BudgetGuardInput,
): Promise<BudgetGuardResult> {
  const now = input.now ?? new Date();

  // ── 1. Load actual spend ───────────────────────────────────────────────────
  const totalSpendCents = await getTotalSpendCents(input.campaignDbId);
  const totalSpentUsd = centsToUsd(totalSpendCents);

  // ── 2. Compute pacing status ───────────────────────────────────────────────
  const pacingStatus = computePacingStatus(
    totalSpentUsd,
    input.campaignStartDate,
    now,
    TOTAL_CAMPAIGN_BUDGET,
    CAMPAIGN_DURATION_DAYS,
    OVERSPEND_BUFFER_PERCENT,
  );

  await logger.info('Pacing status computed', {
    campaignId: input.campaignId,
    state: pacingStatus.state,
    totalSpentUsd: pacingStatus.totalSpentUsd,
    expectedSpendUsd: pacingStatus.expectedSpendUsd,
    deviationFraction: pacingStatus.deviationFraction,
    daysRemaining: pacingStatus.daysRemaining,
  });

  // ── 3. Decide action ───────────────────────────────────────────────────────
  const action = decideSafetyAction(
    pacingStatus,
    input.campaignStartDate,
    now,
  );

  let notes = `Pacing state: ${pacingStatus.state}. Action: ${action}.`;
  let finalAllocations = input.currentAllocations;

  // ── 4. Execute action ──────────────────────────────────────────────────────
  switch (action) {
    case 'PAUSE_ALL_ADS': {
      await logger.warn('Pausing all ads — budget exhausted or campaign ended', {
        campaignId: input.campaignId,
        totalSpentUsd,
        remainingBudgetUsd: pacingStatus.remainingBudgetUsd,
        daysRemaining: pacingStatus.daysRemaining,
      });
      await applyPauseAllocation(input.currentAllocations);
      notes += ' All ad budgets set to minimum to stop delivery.';
      break;
    }

    case 'FREEZE_OPTIMIZER': {
      // Danger state: freeze the optimizer AND reduce budgets aggressively.
      const { allocations: dangerAllocations, noteSuffix: dangerNote } =
        await applyBudgetReduction(
          input.currentAllocations,
          input.campaignId,
          totalSpentUsd,
          pacingStatus.daysRemaining,
          BUDGET_GUARD_DANGER_REDUCTION_FRACTION,
          action,
        );
      finalAllocations = dangerAllocations;
      notes += dangerNote;
      break;
    }

    case 'REDUCE_BUDGETS': {
      // Over-pacing: reduce budgets conservatively.
      const { allocations: reducedAllocations, noteSuffix: reduceNote } =
        await applyBudgetReduction(
          input.currentAllocations,
          input.campaignId,
          totalSpentUsd,
          pacingStatus.daysRemaining,
          BUDGET_GUARD_REDUCTION_FRACTION,
          action,
        );
      finalAllocations = reducedAllocations;
      notes += reduceNote;
      break;
    }

    case 'NONE':
    default:
      // No action needed — log at debug level only.
      logger.debug('Budget guard: no action needed', {
        campaignId: input.campaignId,
        state: pacingStatus.state,
      });
      break;
  }

  // ── 5. Persist guard run ───────────────────────────────────────────────────
  await createBudgetGuardRun({
    campaignId: input.campaignDbId,
    pacingState: pacingStatus.state,
    totalSpendCents,
    expectedSpendCents: Math.round(pacingStatus.expectedSpendUsd * 100),
    action,
    notes,
  });

  return {
    campaignId: input.campaignId,
    pacingStatus,
    actionTaken: action,
    notes,
    executedAt: now,
  };
}
