/**
 * lib/budget/safety.ts
 *
 * Budget Safety Engine.
 */

import type { AdBudgetAllocation } from '../../types/campaign';
import type { BudgetGuardResult, PacingStatus, SafetyAction } from '../../types/optimizer';
import { computePacingStatus, isDangerPacing } from './pacing';
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function applyPauseAllocation(
  allocations: AdBudgetAllocation[],
): Promise<void> {
  if (allocations.length === 0) return;

  const updates = allocations.map((a) => ({
    adSetId: a.adSetId,
    cents: usdToCents(1),
  }));

  const results = await batchUpdateAdSetBudgets(updates);
  const failures = Array.from(results.entries()).filter(([, ok]) => !ok);

  if (failures.length > 0) {
    await logger.warn('Some ad set pause updates failed', {
      failedAdSets: failures.map(([id]) => id),
    });
  }
}

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

async function applyBudgetReduction(
  currentAllocations: AdBudgetAllocation[],
  campaignId: string,
  totalSpentUsd: number,
  daysRemaining: number,
  reductionFraction: number,
  action: SafetyAction,
): Promise<{ noteSuffix: string }> {
  const scaleFactor = 1 - reductionFraction;

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

  const newTotal = round(
    allocations.reduce((s, a) => s + a.dailyBudgetUsd, 0),
    2
  );

  await logger.warn('Budget guard reduced ad spend', {
    campaignId,
    action,
    reductionFraction,
    previousTotal: currentTotal,
    newTotal,
  });

  return {
    noteSuffix:
      ` Budgets reduced by ${Math.round(reductionFraction * 100)}%.` +
      ` New total: $${newTotal}.`,
  };
}

// ─── Decision ─────────────────────────────────────────────────────────────────

export function decideSafetyAction(
  pacingStatus: PacingStatus,
  campaignStartDate: Date,
  now: Date = new Date(),
  durationDays: number = CAMPAIGN_DURATION_DAYS,
): SafetyAction {
  if (pacingStatus.remainingBudgetUsd <= 0 && AUTO_PAUSE_IF_BUDGET_REACHED) {
    return 'PAUSE_ALL_ADS';
  }

  if (
    AUTO_PAUSE_IF_CAMPAIGN_END_REACHED &&
    isCampaignOver(campaignStartDate, now, durationDays)
  ) {
    return 'PAUSE_ALL_ADS';
  }

  if (isDangerPacing(pacingStatus)) {
    return 'FREEZE_OPTIMIZER';
  }

  if (pacingStatus.state === 'OVER_PACING') {
    return 'REDUCE_BUDGETS';
  }

  return 'NONE';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runBudgetGuard(
  input: BudgetGuardInput,
): Promise<BudgetGuardResult> {
  const now = input.now ?? new Date();

  const totalSpendCents = await getTotalSpendCents(input.campaignDbId);
  const totalSpentUsd = centsToUsd(totalSpendCents);

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

  const action = decideSafetyAction(
    pacingStatus,
    input.campaignStartDate,
    now,
  );

  let notes = `Pacing state: ${pacingStatus.state}. Action: ${action}.`;

  switch (action) {
    case 'PAUSE_ALL_ADS': {
      await logger.warn('Pausing all ads', { campaignId: input.campaignId });
      await applyPauseAllocation(input.currentAllocations);
      notes += ' All ads paused.';
      break;
    }

    case 'FREEZE_OPTIMIZER': {
      const { noteSuffix } = await applyBudgetReduction(
        input.currentAllocations,
        input.campaignId,
        totalSpentUsd,
        pacingStatus.daysRemaining,
        BUDGET_GUARD_DANGER_REDUCTION_FRACTION,
        action,
      );
      notes += noteSuffix;
      break;
    }

    case 'REDUCE_BUDGETS': {
      const { noteSuffix } = await applyBudgetReduction(
        input.currentAllocations,
        input.campaignId,
        totalSpentUsd,
        pacingStatus.daysRemaining,
        BUDGET_GUARD_REDUCTION_FRACTION,
        action,
      );
      notes += noteSuffix;
      break;
    }

    case 'NONE':
    default:
      logger.debug('No action needed', { campaignId: input.campaignId });
      break;
  }

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