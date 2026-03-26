import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { centsToUsd } from "@/lib/utils/money";
import { computePacingStatus } from "@/lib/budget/pacing";
import {
  TOTAL_CAMPAIGN_BUDGET,
  CAMPAIGN_DURATION_DAYS,
  OVERSPEND_BUFFER_PERCENT,
} from "@/lib/constants/app";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing campaign id" },
        { status: 400 }
      );
    }

    // 1) Campaign locale
    const campaign = await prisma.campaign.findUnique({
      where: { id },
    });

    if (!campaign) {
      return NextResponse.json(
        { ok: false, error: "Campaign not found" },
        { status: 404 }
      );
    }

    // 2) Derniers runs système liés à la campagne
    const latestOptimizationRun = await prisma.optimizationRun.findFirst({
      where: {
        campaignId: campaign.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const latestBudgetGuardRun = await prisma.budgetGuardRun.findFirst({
      where: {
        campaignId: campaign.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // 3) Spend actuel basé sur le dernier budget guard run (fallback safe)
    const totalSpendCents = latestBudgetGuardRun?.totalSpendCents ?? 0;
    const totalSpentUsd = centsToUsd(totalSpendCents);

    const campaignStartDate = campaign.startDate ?? campaign.createdAt ?? new Date();

    const pacingStatus = computePacingStatus(
      totalSpentUsd,
      campaignStartDate,
      new Date(),
      TOTAL_CAMPAIGN_BUDGET,
      CAMPAIGN_DURATION_DAYS,
      OVERSPEND_BUFFER_PERCENT
    );

    return NextResponse.json({
      ok: true,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        metaId: campaign.metaId ?? null,
        status: campaign.status ?? null,
        startDate: campaign.startDate ?? null,
        stopDate: campaign.stopDate ?? null,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        syncedAt: campaign.syncedAt,
        dailyBudgetCents: campaign.dailyBudgetCents ?? null,
        lifetimeBudgetCents: campaign.lifetimeBudgetCents ?? null,
        objectiveType: campaign.objectiveType ?? null,
      },
      summary: {
        totalSpentUsd,
        totalSpendCents,
        totalBudgetUsd: TOTAL_CAMPAIGN_BUDGET,
        remainingBudgetUsd: pacingStatus.remainingBudgetUsd,
        expectedSpendUsd: pacingStatus.expectedSpendUsd,
        pacingState: pacingStatus.state,
        pacingDeviationFraction: pacingStatus.deviationFraction,
      },
      latestRuns: {
        optimization: latestOptimizationRun,
        budgetGuard: latestBudgetGuardRun,
      },
      pacingStatus,
    });
  } catch (error) {
    console.error("Campaign status route error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load campaign status",
      },
      { status: 500 }
    );
  }
}