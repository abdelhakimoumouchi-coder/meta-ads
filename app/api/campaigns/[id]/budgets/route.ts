/**
 * app/api/campaigns/[id]/budgets/route.ts
 *
 * GET   /api/campaigns/[id]/budgets  – return ad-set budget history for the campaign
 * PATCH /api/campaigns/[id]/budgets  – update an ad-set's daily budget (dry-run aware)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  findCampaignById,
  listAdSetsForCampaign,
  getAdSetBudgetHistory,
} from '../../../../../lib/db/queries';
import { updateAdSetDailyBudget } from '../../../../../lib/meta/budgets';
import { IS_DRY_RUN } from '../../../../../lib/constants/app';

export const dynamic = 'force-dynamic';

// ─── Validation schema ────────────────────────────────────────────────────────

const PatchBudgetSchema = z.object({
  adSetMetaId: z.string().min(1, 'adSetMetaId is required'),
  dailyBudgetCents: z
    .number()
    .int('dailyBudgetCents must be an integer')
    .min(100, 'dailyBudgetCents must be >= 100 (minimum $1.00)'),
  dryRun: z.boolean().optional(),
});

// ─── GET /api/campaigns/[id]/budgets ─────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const campaign = await findCampaignById(id).catch(() => null);
  if (!campaign) {
    return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 404 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PatchBudgetSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 },
    );
  }

  const { adSetMetaId, dailyBudgetCents } = parsed.data;
  // Request-level dry-run OR global safe mode — safety wins.
  const dryRun = parsed.data.dryRun === true || IS_DRY_RUN;

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
