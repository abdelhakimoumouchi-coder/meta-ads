import { notFound } from 'next/navigation';
import prisma from '../../../lib/db/prisma';
import { CampaignOverviewCard } from '../../../components/dashboard/CampaignOverviewCard';
import { CreativePerformanceTable } from '../../../components/dashboard/CreativePerformanceTable';
import { SpendChart } from '../../../components/charts/SpendChart';
import { centsToUsd } from '../../../lib/utils/money';
import { scoreAllAds } from '../../../lib/optimizer/scoring';
import type { AdDailyMetrics } from '../../../types/metrics';
import type { CreativeRow } from '../../../components/dashboard/CreativePerformanceTable';
import type { SpendDataPoint } from '../../../components/charts/SpendChart';

export const dynamic = 'force-dynamic';

interface CampaignPageProps {
  params: Promise<{ id: string }>;
}

export default async function CampaignPage({ params }: CampaignPageProps) {
  const { id } = await params;

  const [campaign, adSets, ads, allMetrics] = await Promise.all([
    prisma.campaign.findUnique({ where: { id } }),
    prisma.adSet.findMany({ where: { campaignId: id }, orderBy: { name: 'asc' } }),
    prisma.ad.findMany({ where: { campaignId: id }, orderBy: { name: 'asc' } }),
    prisma.adMetrics.findMany({
      where: { campaignId: id },
      orderBy: [{ adId: 'asc' }, { date: 'asc' }],
    }),
  ]);

  if (!campaign) notFound();

  // Build metrics map (internalAdId → metaAdId)
  const adMetaIdMap = new Map(ads.map((a) => [a.id, a.metaId]));
  const metricsMapByMetaId = new Map<string, AdDailyMetrics[]>();
  for (const row of allMetrics) {
    const metaAdId = adMetaIdMap.get(row.adId);
    if (!metaAdId) continue;
    if (!metricsMapByMetaId.has(metaAdId)) metricsMapByMetaId.set(metaAdId, []);
    metricsMapByMetaId.get(metaAdId)!.push({
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

  const adScores = scoreAllAds(metricsMapByMetaId);
  const adSetMap = new Map(adSets.map((as) => [as.id, as]));

  // Aggregate totals
  const totalSpendCents = allMetrics.reduce((s, r) => s + r.spendCents, 0);
  const totalImpressions = allMetrics.reduce((s, r) => s + r.impressions, 0);
  const totalClicks = allMetrics.reduce((s, r) => s + r.clicks, 0);
  const totalConversations = allMetrics.reduce((s, r) => s + r.conversationsStarted, 0);

  // Build spend chart data points (per ad)
  const spendData: SpendDataPoint[] = ads.map((ad) => {
    const spendCents = allMetrics
      .filter((m) => m.adId === ad.id)
      .reduce((s, r) => s + r.spendCents, 0);
    return { label: ad.name, spendUsd: centsToUsd(spendCents) };
  });

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

  const TOTAL_BUDGET = Number(process.env.TOTAL_CAMPAIGN_BUDGET ?? 180);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <a
          href="/dashboard"
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          ← Dashboard
        </a>
      </div>

      <h1 className="text-base font-semibold text-gray-100 truncate">{campaign.name}</h1>

      {/* Overview card */}
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
            spendUsd: centsToUsd(totalSpendCents),
          },
        }}
      />

      {/* Spend chart */}
      {spendData.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
            Spend by Creative
          </h2>
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-4">
            <SpendChart data={spendData} budgetCapUsd={TOTAL_BUDGET} />
          </div>
        </section>
      )}

      {/* Creative performance */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Creative Performance
        </h2>
        <CreativePerformanceTable rows={creativeRows} />
      </section>
    </div>
  );
}
