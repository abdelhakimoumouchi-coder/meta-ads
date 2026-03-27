/**
 * app/api/campaigns/[id]/optimize-now/route.ts
 *
 * POST /api/campaigns/[id]/optimize-now
 *
 * Manually triggers the budget optimizer for a specific campaign.
 * Respects the global META_MUTATION_MODE and an optional per-request dryRun flag.
 */

import { NextResponse } from 'next/server';
import { findCampaignById } from '../../../../../lib/db/queries';
import { runOptimizer } from '../../../../../lib/optimizer/decision-engine';
import { IS_DRY_RUN } from '../../../../../lib/constants/app';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const campaign = await findCampaignById(id).catch(() => null);
  if (!campaign) {
    return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 404 });
  }

  // Parse optional body — request-level dryRun is additive; global IS_DRY_RUN wins.
  let requestDryRun: boolean | undefined;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.dryRun === 'boolean') requestDryRun = body.dryRun;
  } catch {
    // Empty body is fine.
  }

  // Global IS_DRY_RUN wins; request-level can only add dry-run protection, not remove it.
  const effectiveDryRun = IS_DRY_RUN || (requestDryRun ?? false);

  try {
    const decision = await runOptimizer({
      trigger: 'manual',
      campaignMetaId: campaign.metaId,
    });

    return NextResponse.json({
      ok: true,
      dryRun: effectiveDryRun,
      campaignId: id,
      campaignMetaId: campaign.metaId,
      reallocated: decision.reallocated,
      skipReason: decision.skipReason ?? null,
      scores: decision.scores.map((s) => ({
        adId: s.adId,
        finalScore: s.finalScore,
        isEligible: s.isEligible,
        spendUsd: s.spendUsd,
      })),
      newAllocation: decision.newAllocation,
      previousAllocation: decision.previousAllocation,
      decidedAt: decision.decidedAt.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
