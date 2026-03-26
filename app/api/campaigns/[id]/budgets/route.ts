import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Campaign budgets route placeholder",
  });
}
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { findCampaignById, listAdSetsForCampaign, recordBudgetHistory } from '../../../../../lib/db/queries';
import { updateAdSetDailyBudget } from '../../../../../lib/meta/budgets';
import { centsToUsd, usdToCents } from '../../../../../lib/utils/money';
import prisma from '../../../../../lib/db/prisma';
import {
  MIN_AD_DAILY_BUDGET,
  MAX_AD_DAILY_BUDGET,
} from '../../../../../lib/constants/app';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/campaigns/[id]/budgets
 * Returns the current daily budget allocation for all ad sets in the campaign.
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

  const adSets = await listAdSetsForCampaign(id);

  return NextResponse.json({
    campaignId: id,
    adSets: adSets.map((as) => ({
      id: as.id,
      metaId: as.metaId,
      name: as.name,
      dailyBudgetUsd: centsToUsd(as.dailyBudgetCents),
      dailyBudgetCents: as.dailyBudgetCents,
    })),
  });
}

/**
 * PATCH /api/campaigns/[id]/budgets
 * Update the daily budget for a single ad set.
 *
 * Body: { adSetId: string; dailyBudgetUsd: number }
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

  let body: { adSetId: string; dailyBudgetUsd: number };
  try {
    body = await request.json() as { adSetId: string; dailyBudgetUsd: number };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { adSetId, dailyBudgetUsd } = body;
  if (!adSetId || typeof dailyBudgetUsd !== 'number') {
    return NextResponse.json(
      { error: 'adSetId (string) and dailyBudgetUsd (number) are required' },
      { status: 400 },
    );
  }

  if (dailyBudgetUsd < MIN_AD_DAILY_BUDGET || dailyBudgetUsd > MAX_AD_DAILY_BUDGET) {
    return NextResponse.json(
      {
        error: `dailyBudgetUsd must be between ${MIN_AD_DAILY_BUDGET} and ${MAX_AD_DAILY_BUDGET}`,
      },
      { status: 422 },
    );
  }

  const adSet = await prisma.adSet.findUnique({ where: { id: adSetId } });
  if (!adSet || adSet.campaignId !== id) {
    return NextResponse.json({ error: 'AdSet not found in this campaign' }, { status: 404 });
  }

  const newCents = usdToCents(dailyBudgetUsd);
  const previousCents = adSet.dailyBudgetCents;

  // Apply to Meta API
  const ok = await updateAdSetDailyBudget(adSet.metaId, newCents);
  if (!ok) {
    return NextResponse.json({ error: 'Meta API rejected the budget update' }, { status: 502 });
  }

  // Persist in DB
  await prisma.adSet.update({
    where: { id: adSetId },
    data: { dailyBudgetCents: newCents, updatedAt: new Date() },
  });

  await recordBudgetHistory({
    adSetId,
    previousCents,
    newCents,
    reason: 'manual_api',
  });

  return NextResponse.json({
    ok: true,
    adSetId,
    previousBudgetUsd: centsToUsd(previousCents),
    newBudgetUsd: centsToUsd(newCents),
  });
}
