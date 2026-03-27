/**
 * lib/meta/budgets.ts
 *
 * Helpers for reading and updating ad-set budgets via the Meta Graph API.
 *
 * IMPORTANT: Meta budgets are stored in USD cents (integer strings).
 * This module works in USD cents for all API I/O.
 * Business logic in lib/optimizer/* works in whole USD — convert at the boundary.
 */

import type { MetaBudgetUpdateResponse } from '../../types/meta';
import { metaGet, metaPost } from './client';
import { IS_DRY_RUN } from '../constants/app';

/**
 * Read the current daily_budget (in USD cents) for an ad set.
 * Returns the integer cent value or null if the field is missing.
 */
export async function fetchAdSetBudgetCents(adSetId: string): Promise<number | null> {
  const data = await metaGet<{ id: string; daily_budget?: string }>(adSetId, {
    fields: 'id,daily_budget',
  });

  if (!data.daily_budget) return null;
  const cents = parseInt(data.daily_budget, 10);
  return Number.isNaN(cents) ? null : cents;
}

/**
 * Update the daily budget of an ad set.
 *
 * @param adSetId   Meta ad set ID
 * @param cents     New daily budget in USD **cents** (must be >= 100 / $1.00)
 * @returns         True if the API confirmed success
 *
 * The Meta API rejects budgets below $1.00 (100 cents). The caller is
 * responsible for enforcing the MIN_AD_DAILY_BUDGET business rule before
 * calling this function.
 */
export async function updateAdSetDailyBudget(
  adSetId: string,
  cents: number,
): Promise<boolean> {
  if (cents < 100) {
    throw new Error(
      `[budgets] Refusing to set daily budget below $1.00 (got ${cents} cents) for adset ${adSetId}`,
    );
  }

  if (IS_DRY_RUN) {
    console.info(
      JSON.stringify({
        level: 'info',
        context: 'budgets:dry-run',
        message: `[dry-run] Would update adset ${adSetId} daily_budget to ${cents} cents ($${(cents / 100).toFixed(2)})`,
        meta: { adSetId, cents },
        timestamp: new Date().toISOString(),
      }),
    );
    return true;
  }

  const result = await metaPost<MetaBudgetUpdateResponse>(
    adSetId,
    {},
    { daily_budget: cents },
  );

  return result.success === true;
}

/**
 * Batch-update daily budgets for multiple ad sets.
 *
 * Applies updates sequentially to stay within rate limits.
 * Returns a map of adSetId → success boolean.
 * Failures are logged but do not abort the remaining updates.
 */
export async function batchUpdateAdSetBudgets(
  updates: Array<{ adSetId: string; cents: number }>,
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  for (const { adSetId, cents } of updates) {
    try {
      const ok = await updateAdSetDailyBudget(adSetId, cents);
      results.set(adSetId, ok);
    } catch (err) {
      // Log but continue — partial success is better than full abort.
      console.error(`[budgets] Failed to update adset ${adSetId}:`, err);
      results.set(adSetId, false);
    }
  }

  return results;
}

/**
 * Convert whole USD to cents.
 * Always rounds to the nearest integer (Meta does not accept fractional cents).
 */
export function usdToCents(usd: number): number {
  return Math.round(usd * 100);
}

/**
 * Convert cents to whole USD.
 */
export function centsToUsd(cents: number): number {
  return cents / 100;
}
