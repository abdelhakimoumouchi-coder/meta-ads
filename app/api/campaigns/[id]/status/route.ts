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
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { findCampaignById } from '../../../../../lib/db/queries';
import { metaPost } from '../../../../../lib/meta/client';
import prisma from '../../../../../lib/db/prisma';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

type CampaignStatusValue = 'ACTIVE' | 'PAUSED';

/**
 * GET /api/campaigns/[id]/status
 * Returns the current status of the campaign.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id } = await params;

  const campaign = await findCampaignById(id);
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  return NextResponse.json({
    campaignId: id,
    metaId: campaign.metaId,
    status: campaign.status,
    syncedAt: campaign.syncedAt.toISOString(),
  });
}

/**
 * PATCH /api/campaigns/[id]/status
 * Set the campaign status to ACTIVE or PAUSED.
 *
 * Body: { status: "ACTIVE" | "PAUSED" }
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id } = await params;

  const campaign = await findCampaignById(id);
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  let body: { status: CampaignStatusValue };
  try {
    body = await request.json() as { status: CampaignStatusValue };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { status } = body;
  if (status !== 'ACTIVE' && status !== 'PAUSED') {
    return NextResponse.json(
      { error: 'status must be "ACTIVE" or "PAUSED"' },
      { status: 422 },
    );
  }

  // Apply to Meta API
  await metaPost<{ success: boolean }>(campaign.metaId, {}, { status });

  // Persist in DB
  await prisma.campaign.update({
    where: { id },
    data: { status, updatedAt: new Date() },
  });

  return NextResponse.json({
    ok: true,
    campaignId: id,
    previousStatus: campaign.status,
    newStatus: status,
  });
}
