import { Suspense } from 'react';
import { CampaignOverviewCard } from '../../components/dashboard/CampaignOverviewCard';
import { BudgetStatusCard } from '../../components/dashboard/BudgetStatusCard';
import { CreativePerformanceTable } from '../../components/dashboard/CreativePerformanceTable';
import { OptimizationLogTable } from '../../components/dashboard/OptimizationLogTable';
import prisma from '../../lib/db/prisma';
import { computePacingStatus } from '../../lib/budget/pacing';
import { scoreAllAds } from '../../lib/optimizer/scoring';
import { centsToUsd } from '../../lib/utils/money';
import type { PacingStatus } from '../../types/optimizer';
import type { AdDailyMetrics } from '../../types/metrics';
import type { CreativeRow } from '../../components/dashboard/CreativePerformanceTable';
import type { DbOptimizationRun } from '../../types/db';

export const dynamic = 'force-dynamic';

// ─── Data fetching ────────────────────────────────────────────────────────────

async function loadDashboardData() {
  const [campaign, adSets, ads, allMetrics, recentRuns] = await Promise.all([
    prisma.campaign.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.adSet.findMany({ orderBy: { name: 'asc' } }),
    prisma.ad.findMany({ orderBy: { name: 'asc' } }),
    prisma.adMetrics.findMany({ orderBy: [{ adId: 'asc' }, { date: 'asc' }] }),
    prisma.optimizationRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
  ]);

  return { campaign, adSets, ads, allMetrics, recentRuns };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMetricsMap(
  dbRows: Awaited<ReturnType<typeof prisma.adMetrics.findMany>>,
  adMetaIds: Map<string, string>,
): Map<string, AdDailyMetrics[]> {
  const result = new Map<string, AdDailyMetrics[]>();
  for (const row of dbRows) {
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

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center">
      <div className="text-indigo-400 text-xs font-semibold uppercase tracking-widest">
        No Campaign Found
      </div>
      <p className="text-gray-500 text-sm max-w-sm">
        Run the bootstrap script or a manual sync to populate campaign data.
      </p>
      <code className="mt-1 text-[11px] text-gray-600 bg-gray-900 px-3 py-1.5 rounded">
        npm run bootstrap
      </code>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const { campaign, adSets, ads, allMetrics, recentRuns } = await loadDashboardData();

  if (!campaign) {
    return <EmptyState />;
  }

  // Build metrics map (internalAdId → metaAdId)
  const adMetaIdMap = new Map(ads.map((a) => [a.id, a.metaId]));
  const metricsMap = buildMetricsMap(allMetrics, adMetaIdMap);

  // Aggregate totals
  const totalSpendCents = allMetrics.reduce((sum, r) => sum + r.spendCents, 0);
  const totalImpressions = allMetrics.reduce((sum, r) => sum + r.impressions, 0);
  const totalClicks = allMetrics.reduce((sum, r) => sum + r.clicks, 0);
  const totalConversations = allMetrics.reduce((sum, r) => sum + r.conversationsStarted, 0);
  const totalSpendUsd = centsToUsd(totalSpendCents);

  // Compute pacing status
  const TOTAL_BUDGET = Number(process.env.TOTAL_CAMPAIGN_BUDGET ?? 180);
  const DURATION_DAYS = Number(process.env.CAMPAIGN_DURATION_DAYS ?? 6);
  const BUFFER_PCT = Number(process.env.OVERSPEND_BUFFER_PERCENT ?? 8);

  const pacingStatus: PacingStatus = computePacingStatus(
    totalSpendUsd,
    campaign.startDate ?? new Date(),
    new Date(),
    TOTAL_BUDGET,
    DURATION_DAYS,
    BUFFER_PCT,
  );

  // Score all ads
  const adScores = scoreAllAds(metricsMap);
  const adSetMap = new Map(adSets.map((as) => [as.id, as]));

  // Build creative rows
  const creativeRows: CreativeRow[] = ads.map((ad) => {
    const adSet = adSetMap.get(ad.adSetId);
    const score = adScores.find((s) => s.adId === ad.metaId) ?? null;
    const adMetrics = allMetrics.filter((m) => m.adId === ad.id);
    const spendCents = adMetrics.reduce((s, r) => s + r.spendCents, 0);
    const impressions = adMetrics.reduce((s, r) => s + r.impressions, 0);
    const weightedCtr =
      impressions > 0
        ? adMetrics.reduce((s, r) => s + r.ctr * r.impressions, 0) / impressions
        : 0;
    const conversations = adMetrics.reduce((s, r) => s + r.conversationsStarted, 0);
    const totalConvCents = adMetrics.reduce(
      (s, r) => s + r.costPerConversationCents * r.conversationsStarted,
      0,
    );
    const costPerConvUsd =
      conversations > 0 ? centsToUsd(totalConvCents / conversations) : null;

    return {
      adId: ad.metaId,
      adName: ad.name,
      adStatus: ad.status,
      dailyBudgetUsd: centsToUsd(adSet?.dailyBudgetCents ?? 0),
      score,
      metrics: {
        spendUsd: centsToUsd(spendCents),
        impressions,
        ctr: weightedCtr,
        conversationsStarted: conversations,
        costPerConversationUsd: costPerConvUsd,
      },
    };
  });

  // Cast optimization runs to DbOptimizationRun[]
  const optimizationRuns = recentRuns as unknown as DbOptimizationRun[];

  return (
    <div className="space-y-6">
      <h1 className="text-base font-semibold text-gray-100">Dashboard</h1>

      {/* Overview cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CampaignOverviewCard
          campaign={{
            name: campaign.name,
            status: campaign.status,
            startDate: campaign.startDate,
            stopDate: campaign.stopDate,
            objectiveType: campaign.objectiveType,
            syncedAt: campaign.syncedAt,
            totals: {
              impressions: totalImpressions,
              clicks: totalClicks,
              conversationsStarted: totalConversations,
              spendUsd: totalSpendUsd,
            },
          }}
        />
        <BudgetStatusCard
          pacing={pacingStatus}
          totalBudgetUsd={TOTAL_BUDGET}
        />
      </div>

      {/* Creative performance */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Creative Performance
        </h2>
        <Suspense fallback={<div className="h-32 rounded-lg bg-gray-800 animate-pulse" />}>
          <CreativePerformanceTable rows={creativeRows} />
        </Suspense>
      </section>

      {/* Optimization log */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Optimization Log
        </h2>
        <OptimizationLogTable runs={optimizationRuns} />
      </section>
    </div>
  );
}
