/**
 * Campaign, AdSet, and Ad entity types.
 *
 * These mirror the Meta Marketing API object shapes after normalisation.
 * Fields match what we persist in the local DB and what the optimizer consumes.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type CampaignStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'DELETED'
  | 'ARCHIVED';

export type AdSetStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'DELETED'
  | 'ARCHIVED';

export type AdStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'DELETED'
  | 'ARCHIVED'
  | 'DISAPPROVED'
  | 'PENDING_REVIEW';

export type BillingEvent =
  | 'IMPRESSIONS'
  | 'LINK_CLICKS'
  | 'THRUPLAY';

export type OptimizationGoal =
  | 'CONVERSATIONS'
  | 'LINK_CLICKS'
  | 'IMPRESSIONS'
  | 'REACH'
  | 'THRUPLAY';

// ─── Campaign ─────────────────────────────────────────────────────────────────

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  /** Daily budget in USD cents (if set at campaign level). */
  dailyBudgetCents: number | null;
  /** Lifetime budget in USD cents (if set at campaign level). */
  lifetimeBudgetCents: number | null;
  /** ISO date string: when the campaign starts. */
  startDate: string | null;
  /** ISO date string: when the campaign ends. */
  stopDate: string | null;
  objectiveType: string;
  /** When this record was last synchronised from Meta. */
  syncedAt: string;
}

// ─── AdSet ────────────────────────────────────────────────────────────────────

export interface AdSet {
  id: string;
  campaignId: string;
  name: string;
  status: AdSetStatus;
  /** Daily budget in USD cents. */
  dailyBudgetCents: number;
  billingEvent: BillingEvent;
  optimizationGoal: OptimizationGoal;
  /** ISO date string. */
  startTime: string | null;
  /** ISO date string. */
  endTime: string | null;
  syncedAt: string;
}

// ─── Ad / Creative ────────────────────────────────────────────────────────────

export interface Ad {
  id: string;
  adSetId: string;
  campaignId: string;
  name: string;
  status: AdStatus;
  creativeId: string | null;
  syncedAt: string;
}

// ─── Budget allocation ────────────────────────────────────────────────────────

/**
 * Represents a single ad's share of the daily budget.
 * All amounts are in whole USD (not cents) for readability in business logic.
 */
export interface AdBudgetAllocation {
  adId: string;
  adSetId: string;
  dailyBudgetUsd: number;
}

/** Full daily budget split across all active ads. */
export interface DailyBudgetSplit {
  allocations: AdBudgetAllocation[];
  /** Sum of all ad budgets for the day. Should equal BASE_DAILY_BUDGET. */
  totalDailyUsd: number;
  computedAt: string;
}
