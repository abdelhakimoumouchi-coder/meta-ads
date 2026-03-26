/**
 * Database record types.
 *
 * These represent the shape of rows as returned by Prisma after
 * `prisma generate`.  Having explicit TS types here lets the rest of the app
 * reference them without importing Prisma's generated namespace everywhere.
 *
 * Keep these in sync with `prisma/schema.prisma`.
 */

// ─── Core entity records ──────────────────────────────────────────────────────

export interface DbCampaign {
  id: string;
  metaId: string;
  name: string;
  status: string;
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
  startDate: Date | null;
  stopDate: Date | null;
  objectiveType: string | null;
  createdAt: Date;
  updatedAt: Date;
  syncedAt: Date;
}

export interface DbAdSet {
  id: string;
  metaId: string;
  campaignId: string;
  name: string;
  status: string;
  dailyBudgetCents: number;
  billingEvent: string | null;
  optimizationGoal: string | null;
  startTime: Date | null;
  endTime: Date | null;
  createdAt: Date;
  updatedAt: Date;
  syncedAt: Date;
}

export interface DbAd {
  id: string;
  metaId: string;
  adSetId: string;
  campaignId: string;
  name: string;
  status: string;
  creativeId: string | null;
  createdAt: Date;
  updatedAt: Date;
  syncedAt: Date;
}

// ─── Metrics snapshot ─────────────────────────────────────────────────────────

/** One row per (adId, date) — a daily performance snapshot. */
export interface DbAdMetrics {
  id: string;
  adId: string;
  campaignId: string;
  /** UTC date the metrics cover (midnight). */
  date: Date;
  impressions: number;
  clicks: number;
  linkClicks: number;
  /** Total spend in USD cents. */
  spendCents: number;
  reach: number;
  frequency: number;
  cpm: number;
  ctr: number;
  cpc: number;
  conversationsStarted: number;
  costPerConversationCents: number;
  videoPct25: number;
  videoPct50: number;
  videoPct75: number;
  videoPct100: number;
  videoThruPlays: number;
  outboundClicks: number;
  outboundCtr: number;
  reactions: number;
  comments: number;
  shares: number;
  createdAt: Date;
}

// ─── Optimization decision log ────────────────────────────────────────────────

export interface DbOptimizationRun {
  id: string;
  campaignId: string;
  triggeredBy: 'cron' | 'manual';
  /** Whether a reallocation actually happened (false = skipped / blocked). */
  reallocated: boolean;
  skipReason: string | null;
  /** JSON-serialised AdBudgetAllocation[] before the run. */
  previousAllocationJson: string;
  /** JSON-serialised AdBudgetAllocation[] after the run (null if skipped). */
  newAllocationJson: string | null;
  /** JSON-serialised AdScore[] used for the decision. */
  scoresJson: string;
  createdAt: Date;
}

// ─── Budget guard log ─────────────────────────────────────────────────────────

export interface DbBudgetGuardRun {
  id: string;
  campaignId: string;
  pacingState: string;
  totalSpendCents: number;
  expectedSpendCents: number;
  action: string;
  notes: string | null;
  createdAt: Date;
}

// ─── Sync run log ─────────────────────────────────────────────────────────────

export interface DbSyncRun {
  id: string;
  campaignId: string;
  success: boolean;
  errorMessage: string | null;
  durationMs: number;
  createdAt: Date;
}
