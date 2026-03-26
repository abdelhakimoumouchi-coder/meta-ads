/**
 * lib/db/queries.ts
 *
 * Typed query helpers for all database operations.
 *
 * These functions are the single point of contact between application code and
 * the Prisma client.  They enforce:
 *   - Correct input types
 *   - Upsert semantics (idempotent syncs)
 *   - Consistent ordering / filtering conventions
 *
 * All monetary values stored in the DB are in USD cents (integer).
 * Conversion from USD happens at the call site.
 */

import type {
  Campaign,
  AdSet,
  Ad,
  AdMetrics,
  OptimizationRun,
  BudgetGuardRun,
  SyncRun,
  SystemLog,
  BudgetHistory,
} from '@prisma/client';
import prisma from './prisma';
import type { DbCampaign, DbAdSet, DbAd, DbAdMetrics, DbOptimizationRun, DbBudgetGuardRun, DbSyncRun } from '../../types/db';

// Re-export Prisma model types for convenience
export type { Campaign, AdSet, Ad, AdMetrics, OptimizationRun, BudgetGuardRun, SyncRun, SystemLog, BudgetHistory };

// ─── Campaign queries ─────────────────────────────────────────────────────────

/**
 * Upsert a campaign record from a sync run.
 * Uses metaId as the unique key so duplicate syncs are safe.
 */
export async function upsertCampaign(
  data: Omit<DbCampaign, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Campaign> {
  return prisma.campaign.upsert({
    where: { metaId: data.metaId },
    create: {
      metaId: data.metaId,
      name: data.name,
      status: data.status,
      dailyBudgetCents: data.dailyBudgetCents,
      lifetimeBudgetCents: data.lifetimeBudgetCents,
      startDate: data.startDate,
      stopDate: data.stopDate,
      objectiveType: data.objectiveType,
      syncedAt: data.syncedAt,
    },
    update: {
      name: data.name,
      status: data.status,
      dailyBudgetCents: data.dailyBudgetCents,
      lifetimeBudgetCents: data.lifetimeBudgetCents,
      startDate: data.startDate,
      stopDate: data.stopDate,
      objectiveType: data.objectiveType,
      syncedAt: data.syncedAt,
    },
  });
}

/**
 * Find a campaign by its Meta ID.
 * Returns null if not found.
 */
export async function findCampaignByMetaId(metaId: string): Promise<Campaign | null> {
  return prisma.campaign.findUnique({ where: { metaId } });
}

/**
 * Find a campaign by its internal DB ID.
 */
export async function findCampaignById(id: string): Promise<Campaign | null> {
  return prisma.campaign.findUnique({ where: { id } });
}

/**
 * List all campaigns, newest first.
 */
export async function listCampaigns(): Promise<Campaign[]> {
  return prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } });
}

// ─── AdSet queries ────────────────────────────────────────────────────────────

/**
 * Upsert an ad set record.
 */
export async function upsertAdSet(
  data: Omit<DbAdSet, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<AdSet> {
  return prisma.adSet.upsert({
    where: { metaId: data.metaId },
    create: {
      metaId: data.metaId,
      campaignId: data.campaignId,
      name: data.name,
      status: data.status,
      dailyBudgetCents: data.dailyBudgetCents,
      billingEvent: data.billingEvent,
      optimizationGoal: data.optimizationGoal,
      startTime: data.startTime,
      endTime: data.endTime,
      syncedAt: data.syncedAt,
    },
    update: {
      campaignId: data.campaignId,
      name: data.name,
      status: data.status,
      dailyBudgetCents: data.dailyBudgetCents,
      billingEvent: data.billingEvent,
      optimizationGoal: data.optimizationGoal,
      startTime: data.startTime,
      endTime: data.endTime,
      syncedAt: data.syncedAt,
    },
  });
}

/**
 * Find an ad set by its Meta ID.
 */
export async function findAdSetByMetaId(metaId: string): Promise<AdSet | null> {
  return prisma.adSet.findUnique({ where: { metaId } });
}

/**
 * List all ad sets for a campaign (by internal campaign DB ID).
 */
export async function listAdSetsForCampaign(campaignId: string): Promise<AdSet[]> {
  return prisma.adSet.findMany({
    where: { campaignId },
    orderBy: { name: 'asc' },
  });
}

// ─── Ad queries ───────────────────────────────────────────────────────────────

/**
 * Upsert an ad record.
 */
export async function upsertAd(
  data: Omit<DbAd, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Ad> {
  return prisma.ad.upsert({
    where: { metaId: data.metaId },
    create: {
      metaId: data.metaId,
      adSetId: data.adSetId,
      campaignId: data.campaignId,
      name: data.name,
      status: data.status,
      creativeId: data.creativeId,
      syncedAt: data.syncedAt,
    },
    update: {
      adSetId: data.adSetId,
      campaignId: data.campaignId,
      name: data.name,
      status: data.status,
      creativeId: data.creativeId,
      syncedAt: data.syncedAt,
    },
  });
}

/**
 * Find an ad by its Meta ID.
 */
export async function findAdByMetaId(metaId: string): Promise<Ad | null> {
  return prisma.ad.findUnique({ where: { metaId } });
}

/**
 * List all ads for a campaign (by internal campaign DB ID).
 */
export async function listAdsForCampaign(campaignId: string): Promise<Ad[]> {
  return prisma.ad.findMany({
    where: { campaignId },
    orderBy: { name: 'asc' },
  });
}

// ─── AdMetrics queries ────────────────────────────────────────────────────────

/**
 * Upsert a daily metrics snapshot for an ad.
 * The unique key is (adId, date).
 */
export async function upsertAdMetrics(
  data: Omit<DbAdMetrics, 'id' | 'createdAt'>,
): Promise<AdMetrics> {
  return prisma.adMetrics.upsert({
    where: { adId_date: { adId: data.adId, date: data.date } },
    create: {
      adId: data.adId,
      campaignId: data.campaignId,
      date: data.date,
      impressions: data.impressions,
      clicks: data.clicks,
      linkClicks: data.linkClicks,
      spendCents: data.spendCents,
      reach: data.reach,
      frequency: data.frequency,
      cpm: data.cpm,
      ctr: data.ctr,
      cpc: data.cpc,
      conversationsStarted: data.conversationsStarted,
      costPerConversationCents: data.costPerConversationCents,
      videoPct25: data.videoPct25,
      videoPct50: data.videoPct50,
      videoPct75: data.videoPct75,
      videoPct100: data.videoPct100,
      videoThruPlays: data.videoThruPlays,
      outboundClicks: data.outboundClicks,
      outboundCtr: data.outboundCtr,
      reactions: data.reactions,
      comments: data.comments,
      shares: data.shares,
    },
    update: {
      impressions: data.impressions,
      clicks: data.clicks,
      linkClicks: data.linkClicks,
      spendCents: data.spendCents,
      reach: data.reach,
      frequency: data.frequency,
      cpm: data.cpm,
      ctr: data.ctr,
      cpc: data.cpc,
      conversationsStarted: data.conversationsStarted,
      costPerConversationCents: data.costPerConversationCents,
      videoPct25: data.videoPct25,
      videoPct50: data.videoPct50,
      videoPct75: data.videoPct75,
      videoPct100: data.videoPct100,
      videoThruPlays: data.videoThruPlays,
      outboundClicks: data.outboundClicks,
      outboundCtr: data.outboundCtr,
      reactions: data.reactions,
      comments: data.comments,
      shares: data.shares,
    },
  });
}

/**
 * Get all metrics for an ad, ordered by date ascending.
 */
export async function getAdMetrics(adId: string): Promise<AdMetrics[]> {
  return prisma.adMetrics.findMany({
    where: { adId },
    orderBy: { date: 'asc' },
  });
}

/**
 * Get the aggregate metrics for each ad in a campaign.
 * Returns a map of adId → summed values.
 * Useful for the optimizer's scoring phase.
 */
export async function getAggregatedMetricsForCampaign(
  campaignId: string,
): Promise<AdMetrics[]> {
  return prisma.adMetrics.findMany({
    where: { campaignId },
    orderBy: [{ adId: 'asc' }, { date: 'asc' }],
  });
}

/**
 * Get total spend in cents across all ads for a campaign.
 */
export async function getTotalSpendCents(campaignId: string): Promise<number> {
  const result = await prisma.adMetrics.aggregate({
    where: { campaignId },
    _sum: { spendCents: true },
  });
  return result._sum.spendCents ?? 0;
}

// ─── Optimization run queries ─────────────────────────────────────────────────

/**
 * Log an optimization run result.
 */
export async function createOptimizationRun(
  data: Omit<DbOptimizationRun, 'id' | 'createdAt'>,
): Promise<OptimizationRun> {
  return prisma.optimizationRun.create({
    data: {
      campaignId: data.campaignId,
      triggeredBy: data.triggeredBy,
      reallocated: data.reallocated,
      skipReason: data.skipReason,
      previousAllocationJson: data.previousAllocationJson,
      newAllocationJson: data.newAllocationJson,
      scoresJson: data.scoresJson,
    },
  });
}

/**
 * Get the most recent optimization run for a campaign.
 */
export async function getLatestOptimizationRun(
  campaignId: string,
): Promise<OptimizationRun | null> {
  return prisma.optimizationRun.findFirst({
    where: { campaignId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * List recent optimization runs for a campaign (newest first).
 */
export async function listOptimizationRuns(
  campaignId: string,
  limit = 20,
): Promise<OptimizationRun[]> {
  return prisma.optimizationRun.findMany({
    where: { campaignId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

// ─── Budget guard run queries ─────────────────────────────────────────────────

/**
 * Log a budget guard evaluation result.
 */
export async function createBudgetGuardRun(
  data: Omit<DbBudgetGuardRun, 'id' | 'createdAt'>,
): Promise<BudgetGuardRun> {
  return prisma.budgetGuardRun.create({
    data: {
      campaignId: data.campaignId,
      pacingState: data.pacingState,
      totalSpendCents: data.totalSpendCents,
      expectedSpendCents: data.expectedSpendCents,
      action: data.action,
      notes: data.notes,
    },
  });
}

/**
 * List recent budget guard runs for a campaign (newest first).
 */
export async function listBudgetGuardRuns(
  campaignId: string,
  limit = 20,
): Promise<BudgetGuardRun[]> {
  return prisma.budgetGuardRun.findMany({
    where: { campaignId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

// ─── Sync run queries ─────────────────────────────────────────────────────────

/**
 * Log the result of a sync run.
 */
export async function createSyncRun(
  data: Omit<DbSyncRun, 'id' | 'createdAt'>,
): Promise<SyncRun> {
  return prisma.syncRun.create({
    data: {
      campaignId: data.campaignId,
      success: data.success,
      errorMessage: data.errorMessage,
      durationMs: data.durationMs,
    },
  });
}

/**
 * Get the most recent sync run for a campaign.
 */
export async function getLatestSyncRun(
  campaignId: string,
): Promise<SyncRun | null> {
  return prisma.syncRun.findFirst({
    where: { campaignId },
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Budget history queries ───────────────────────────────────────────────────

/**
 * Record a budget change for an ad set.
 */
export async function recordBudgetHistory(data: {
  adSetId: string;
  previousCents: number;
  newCents: number;
  reason: string;
}): Promise<BudgetHistory> {
  return prisma.budgetHistory.create({ data });
}

/**
 * Get the full budget change history for an ad set.
 */
export async function getAdSetBudgetHistory(adSetId: string): Promise<BudgetHistory[]> {
  return prisma.budgetHistory.findMany({
    where: { adSetId },
    orderBy: { createdAt: 'asc' },
  });
}

// ─── System log queries ───────────────────────────────────────────────────────

/**
 * Write a structured log entry to the database.
 * Use sparingly for events that need to be visible on the dashboard.
 */
export async function writeSystemLog(data: {
  level: 'info' | 'warn' | 'error';
  context: string;
  message: string;
  meta?: Record<string, unknown>;
}): Promise<SystemLog> {
  return prisma.systemLog.create({
    data: {
      level: data.level,
      context: data.context,
      message: data.message,
      metaJson: data.meta ? JSON.stringify(data.meta) : null,
    },
  });
}

/**
 * List recent system log entries, newest first.
 */
export async function listSystemLogs(
  context?: string,
  limit = 50,
): Promise<SystemLog[]> {
  return prisma.systemLog.findMany({
    where: context ? { context } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
