import { NextResponse } from 'next/server';
import { runBudgetGuard } from '../../../../lib/budget/safety';
import { findCampaignByMetaId, listAdsForCampaign, listAdSetsForCampaign } from '../../../../lib/db/queries';
import { META_CAMPAIGN_ID } from '../../../../lib/meta/config';
import { centsToUsd } from '../../../../lib/utils/money';
import { cronLogger as logger } from '../../../../lib/logs/logger';
import { BASE_DAILY_BUDGET } from '../../../../lib/constants/app';
import type { AdBudgetAllocation } from '../../../../types/campaign';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  try {
    await logger.info('budget-guard cron started');

    const campaign = await findCampaignByMetaId(META_CAMPAIGN_ID);
    if (!campaign) {
      return NextResponse.json(
        { ok: false, error: `Campaign ${META_CAMPAIGN_ID} not found in DB. Run sync first.` },
        { status: 404 },
      );
    }

    const [ads, adSets] = await Promise.all([
      listAdsForCampaign(campaign.id),
      listAdSetsForCampaign(campaign.id),
    ]);

    const adSetMap = new Map(adSets.map((as) => [as.id, as]));
    const currentAllocations: AdBudgetAllocation[] = ads.map((ad) => {
      const adSet = adSetMap.get(ad.adSetId);
      const fallbackCents = Math.round((BASE_DAILY_BUDGET / Math.max(ads.length, 1)) * 100);
      return {
        adId: ad.metaId,
        adSetId: ad.adSetId,
        dailyBudgetUsd: centsToUsd(adSet?.dailyBudgetCents ?? fallbackCents),
      };
    });

    const result = await runBudgetGuard({
      campaignId: META_CAMPAIGN_ID,
      campaignDbId: campaign.id,
      campaignStartDate: campaign.startDate ?? new Date(),
      currentAllocations,
    });

    await logger.info('budget-guard cron complete', {
      pacingState: result.pacingStatus.state,
      actionTaken: result.actionTaken,
      notes: result.notes,
    });

    return NextResponse.json({
      ok: true,
      campaignId: META_CAMPAIGN_ID,
      pacingState: result.pacingStatus.state,
      totalSpentUsd: result.pacingStatus.totalSpentUsd,
      expectedSpendUsd: result.pacingStatus.expectedSpendUsd,
      actionTaken: result.actionTaken,
      notes: result.notes,
      executedAt: result.executedAt.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logger.error('budget-guard cron failed', { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
