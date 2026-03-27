/**
 * app/api/campaigns/[id]/budgets/route.ts
 *
 * GET   /api/campaigns/[id]/budgets  – return ad-set budget history for the campaign
 * PATCH /api/campaigns/[id]/budgets  – update an ad-set's daily budget (dry-run aware)
 */

import { NextResponse } from 'next/server';
import {
  findCampaignById,
  listAdSetsForCampaign,
  getAdSetBudgetHistory,
} from '../../../../../lib/db/queries';
import { updateAdSetDailyBudget } from '../../../../../lib/meta/budgets';
import { IS_DRY_RUN } from '../../../../../lib/constants/app';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

// ─── GET /api/campaigns/[id]/budgets ─────────────────────────────────────────

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const campaign = await findCampaignById(id).catch(() => null);
  if (!campaign) {
    return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 404 });
  }

  const adSets = await listAdSetsForCampaign(campaign.id);
  if (adSets.length === 0) {
    return NextResponse.json({
      ok: true,
      campaignId: id,
      skipReason: 'NO_ADSETS',
      message: 'No ad sets found for this campaign. Run sync first.',
      adSets: [],
    });
  }

  const adSetsWithHistory = await Promise.all(
    adSets.map(async (as) => ({
      adSetId: as.id,
      adSetMetaId: as.metaId,
      adSetName: as.name,
      status: as.status,
      currentDailyBudgetCents: as.dailyBudgetCents,
      history: await getAdSetBudgetHistory(as.id),
    })),
  );

  return NextResponse.json({ ok: true, campaignId: id, adSets: adSetsWithHistory });
}

// ─── PATCH /api/campaigns/[id]/budgets ───────────────────────────────────────

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const campaign = await findCampaignById(id).catch(() => null);
  if (!campaign) {
    return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 404 });
  }

  const body = (await req.json()) as Record<string, unknown>;

  const adSetMetaId =
    typeof body.adSetMetaId === 'string' ? body.adSetMetaId.trim() : '';
  const dailyBudgetCents =
    typeof body.dailyBudgetCents === 'number' ? body.dailyBudgetCents : null;
  // Request-level dry-run OR global safe mode — safety wins.
  const dryRun = body.dryRun === true || IS_DRY_RUN;
  if (!adSetMetaId) {
    return NextResponse.json(
      { ok: false, error: 'adSetMetaId is required' },
      { status: 400 },
    );
  }
  if (dailyBudgetCents === null || dailyBudgetCents < 100) {
    return NextResponse.json(
      { ok: false, error: 'dailyBudgetCents must be a number >= 100 (minimum $1.00)' },
      { status: 400 },
    );
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      adSetMetaId,
      dailyBudgetCents,
      message: `[dry-run] Would update adset ${adSetMetaId} daily_budget to ${dailyBudgetCents} cents ($${(dailyBudgetCents / 100).toFixed(2)})`,
    });
  }

  try {
    const success = await updateAdSetDailyBudget(adSetMetaId, dailyBudgetCents);
    return NextResponse.json({ ok: success, adSetMetaId, dailyBudgetCents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
