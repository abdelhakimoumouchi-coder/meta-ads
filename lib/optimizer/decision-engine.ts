/**
 * lib/optimizer/decision-engine.ts
 *
 * Main decision orchestrator for the creative optimizer.
 *
 * This module ties together:
 *   1. Load current data   (DB: metrics, last run, current allocations)
 *   2. Score all ads        (lib/optimizer/scoring.ts)
 *   3. Run guard rules      (lib/optimizer/rules.ts)
 *   4. Compute reallocation (lib/optimizer/reallocator.ts)
 *   5. Apply to Meta API    (lib/meta/budgets.ts)
 *   6. Persist the decision (lib/db/queries.ts)
 *   7. Return the decision  (for cron route / API response)
 *
 * This is intentionally the only place in the app that:
 * - calls the Meta budget update API from the optimizer path
 * - writes OptimizationRun records
 */

import type { AdMetrics } from '@prisma/client';
import type {
  OptimizationDecision,
  OptimizationTrigger,
} from '../../types/optimizer';
import type { AdBudgetAllocation } from '../../types/campaign';
import type { AdDailyMetrics } from '../../types/metrics';

import { scoreAllAds } from './scoring';
import { runAllGuards } from './rules';
import { computeReallocation } from './reallocator';
import { computePacingStatus } from '../budget/pacing';
import { batchUpdateAdSetBudgets, usdToCents } from '../meta/budgets';
import {
  getAggregatedMetricsForCampaign,
  getTotalSpendCents,
  getLatestOptimizationRun,
  listAdSetsForCampaign,
  listAdsForCampaign,
  createOptimizationRun,
  findCampaignByMetaId,
} from '../db/queries';
import { centsToUsd } from '../utils/money';
import { createLogger } from '../logs/logger';
import { META_CAMPAIGN_ID } from '../meta/config';
import {
  TOTAL_CAMPAIGN_BUDGET,
  CAMPAIGN_DURATION_DAYS,
  OVERSPEND_BUFFER_PERCENT,
  BASE_DAILY_BUDGET,
} from '../constants/app';

const logger = createLogger('optimizer');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RunOptimizerInput {
  trigger: OptimizationTrigger;
  /**
   * Explicitly target a campaign by Meta campaign ID.
   * Falls back to the META_CAMPAIGN_ID environment variable when omitted.
   */
  campaignMetaId?: string;
  /** Override campaign start date (useful for testing). */
  campaignStartDate?: Date;
  now?: Date;
}

// ─── Data loading helpers ─────────────────────────────────────────────────────

/**
 * Convert DB AdMetrics rows (cents) to AdDailyMetrics (USD) and group by adId.
 */
function buildMetricsMap(
  dbRows: AdMetrics[],
  adMetaIds: Map<string, string>, // internal DB id → Meta id
): Map<string, AdDailyMetrics[]> {
  const result = new Map<string, AdDailyMetrics[]>();

  for (const row of dbRows) {
    // Map internal adId to Meta ad ID.
    const metaAdId = adMetaIds.get(row.adId);
    if (!metaAdId) continue;

    if (!result.has(metaAdId)) result.set(metaAdId, []);

    result.get(metaAdId)!.push({
      adId: metaAdId,
      campaignId: row.campaignId,
      date: row.date,
      impressions: row.impressions,
      reach: row.reach,
      frequency: row.frequency,
      clicks: row.clicks,
      linkClicks: row.linkClicks,
      outboundClicks: row.outboundClicks,
      spendUsd: centsToUsd(row.spendCents),
      cpm: row.cpm,
      ctr: row.ctr,
      cpc: row.cpc,
      outboundCtr: row.outboundCtr,
      conversationsStarted: row.conversationsStarted,
      costPerConversationUsd: centsToUsd(row.costPerConversationCents),
      videoPct25: row.videoPct25,
      videoPct50: row.videoPct50,
      videoPct75: row.videoPct75,
      videoPct100: row.videoPct100,
      videoThruPlays: row.videoThruPlays,
      reactions: row.reactions,
      comments: row.comments,
      shares: row.shares,
    });
  }

  return result;
}

/**
 * Build a map of Meta adId → current daily budget (USD) from DB ad sets.
 * The ad's parent ad set holds the budget in the Meta data model.
 */
function buildCurrentAllocations(
  ads: Awaited<ReturnType<typeof listAdsForCampaign>>,
  adSets: Awaited<ReturnType<typeof listAdSetsForCampaign>>,
): AdBudgetAllocation[] {
  const adSetMap = new Map(adSets.map((as) => [as.id, as]));

  return ads.map((ad) => {
    const adSet = adSetMap.get(ad.adSetId);
    // dailyBudgetCents is in cents; fall back to an evenly split USD→cents value.
    const fallbackCents = Math.round((BASE_DAILY_BUDGET / Math.max(ads.length, 1)) * 100);
    const dailyBudgetCents = adSet?.dailyBudgetCents ?? fallbackCents;
    return {
      adId: ad.metaId,
      adSetId: ad.adSetId, // internal DB id (used for budget history)
      dailyBudgetUsd: centsToUsd(dailyBudgetCents),
    };
  });
}

// ─── Main optimizer entry point ───────────────────────────────────────────────

/**
 * Run the creative optimizer for the configured campaign.
 *
 * This function is the single entrypoint called by:
 *   - The `/api/cron/optimize-creatives` route (trigger = 'cron')
 *   - The `/api/campaigns/[id]/optimize-now` route (trigger = 'manual')
 *
 * It is idempotent: running it when all guards pass will produce a decision
 * and persist it; running it when guards fail will persist a skip record.
 */
export async function runOptimizer(
  input: RunOptimizerInput,
): Promise<OptimizationDecision> {
  const now = input.now ?? new Date();

  // ── 1. Resolve campaign ────────────────────────────────────────────────────
  const targetMetaId = input.campaignMetaId ?? META_CAMPAIGN_ID;
  if (!targetMetaId) {
    throw new Error(
      '[optimizer] No campaign ID provided. Pass campaignMetaId parameter or set META_CAMPAIGN_ID environment variable.',
    );
  }

  const campaign = await findCampaignByMetaId(targetMetaId);
  if (!campaign) {
    throw new Error(
      `[optimizer] Campaign ${targetMetaId} not found in DB. Run sync first.`,
    );
  }

  const campaignStartDate =
    input.campaignStartDate ?? campaign.startDate ?? now;

  // ── 2. Load metrics and compute totals ────────────────────────────────────
  const [dbMetrics, totalSpendCents, lastRun, ads, adSets] = await Promise.all([
    getAggregatedMetricsForCampaign(campaign.id),
    getTotalSpendCents(campaign.id),
    getLatestOptimizationRun(campaign.id),
    listAdsForCampaign(campaign.id),
    listAdSetsForCampaign(campaign.id),
  ]);

  const totalSpentUsd = centsToUsd(totalSpendCents);

  // Build a map of internal adId → Meta adId for metric lookup.
  const adMetaIdMap = new Map(ads.map((a) => [a.id, a.metaId]));
  const metricsMap = buildMetricsMap(dbMetrics, adMetaIdMap);

  // Current allocations from DB ad sets.
  const currentAllocations = buildCurrentAllocations(ads, adSets);

  // ── 3. Score all ads ───────────────────────────────────────────────────────
  const scores = scoreAllAds(metricsMap);

  // ── 4. Compute pacing ─────────────────────────────────────────────────────
  const pacingStatus = computePacingStatus(
    totalSpentUsd,
    campaignStartDate,
    now,
    TOTAL_CAMPAIGN_BUDGET,
    CAMPAIGN_DURATION_DAYS,
    OVERSPEND_BUFFER_PERCENT,
  );

  // ── 5. Run guards ─────────────────────────────────────────────────────────
  const lastReallocatedAt =
    lastRun?.reallocated ? lastRun.createdAt : null;

  const guardResult = runAllGuards({
    lastReallocatedAt,
    totalSpentUsd,
    campaignStartDate,
    pacingStatus,
    scores,
    now,
  });

  if (!guardResult.allowed) {
    await logger.info('Optimizer skipped', {
      campaignId: targetMetaId,
      trigger: input.trigger,
      skipReason: guardResult.skipReason,
      message: guardResult.message,
    });

    // Persist skip record.
    await createOptimizationRun({
      campaignId: campaign.id,
      triggeredBy: input.trigger,
      reallocated: false,
      skipReason: guardResult.skipReason ?? null,
      previousAllocationJson: JSON.stringify(currentAllocations),
      newAllocationJson: null,
      scoresJson: JSON.stringify(scores),
    });

    return {
      campaignId: targetMetaId,
      trigger: input.trigger,
      reallocated: false,
      skipReason: guardResult.skipReason,
      scores,
      previousAllocation: currentAllocations,
      newAllocation: null,
      decidedAt: now,
    };
  }

  // ── 6. Compute new allocation ─────────────────────────────────────────────
  const reallocationResult = computeReallocation({
    scores,
    currentAllocations,
    targetDailyUsd: BASE_DAILY_BUDGET,
  });

  await logger.info('Reallocation computed', {
    campaignId: targetMetaId,
    trigger: input.trigger,
    deltas: reallocationResult.deltas,
    newTotalUsd: reallocationResult.newTotalUsd,
  });

  // ── 7. Apply to Meta API ──────────────────────────────────────────────────
  // Build the adSetId → cents updates.
  // NOTE: The adSetId on AdBudgetAllocation is currently stored as the *internal DB ID*
  // of the ad set.  We need the Meta adSet ID (metaId) for the API call.
  const adSetDbToMeta = new Map(adSets.map((as) => [as.id, as.metaId]));

  const budgetUpdates = reallocationResult.newAllocations
    .map((alloc) => {
      const metaAdSetId = adSetDbToMeta.get(alloc.adSetId);
      if (!metaAdSetId) return null;
      return { adSetId: metaAdSetId, cents: usdToCents(alloc.dailyBudgetUsd) };
    })
    .filter((u): u is { adSetId: string; cents: number } => u !== null);

  if (budgetUpdates.length > 0) {
    const results = await batchUpdateAdSetBudgets(budgetUpdates);
    const failures = Array.from(results.entries()).filter(([, ok]) => !ok);
    if (failures.length > 0) {
      await logger.warn('Some budget updates failed during reallocation', {
        failedAdSets: failures.map(([id]) => id),
      });
    }
  }

  // ── 8. Persist decision ───────────────────────────────────────────────────
  await createOptimizationRun({
    campaignId: campaign.id,
    triggeredBy: input.trigger,
    reallocated: true,
    skipReason: null,
    previousAllocationJson: JSON.stringify(currentAllocations),
    newAllocationJson: JSON.stringify(reallocationResult.newAllocations),
    scoresJson: JSON.stringify(scores),
  });

  await logger.info('Optimization complete', {
    campaignId: targetMetaId,
    trigger: input.trigger,
    newTotalUsd: reallocationResult.newTotalUsd,
    scores: scores.map((s) => ({ adId: s.adId, score: s.finalScore, eligible: s.isEligible })),
  });

  return {
    campaignId: targetMetaId,
    trigger: input.trigger,
    reallocated: true,
    scores,
    previousAllocation: currentAllocations,
    newAllocation: reallocationResult.newAllocations,
    decidedAt: now,
  };
}
