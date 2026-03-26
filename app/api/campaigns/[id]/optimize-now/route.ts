import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    ok: true,
    message: "Optimize now triggered (placeholder)",
  });
}
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { runOptimizer } from '../../../../../lib/optimizer/decision-engine';
import { findCampaignById } from '../../../../../lib/db/queries';
import { optimizerLogger as logger } from '../../../../../lib/logs/logger';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/campaigns/[id]/optimize-now
 * Trigger a manual optimization run for the campaign.
 *
 * The campaign [id] in the URL is the internal DB ID; the optimizer uses the
 * configured META_CAMPAIGN_ID from env to look up data from Meta.
 */
export async function POST(
  _request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id } = await params;

  const campaign = await findCampaignById(id);
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  try {
    await logger.info('Manual optimization triggered via API', { campaignDbId: id });

    const decision = await runOptimizer({ trigger: 'manual' });

    return NextResponse.json({
      ok: true,
      campaignId: decision.campaignId,
      reallocated: decision.reallocated,
      skipReason: decision.skipReason ?? null,
      scores: decision.scores.map((s) => ({
        adId: s.adId,
        finalScore: s.finalScore,
        isEligible: s.isEligible,
        spendUsd: s.spendUsd,
      })),
      newAllocation: decision.newAllocation,
      decidedAt: decision.decidedAt.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logger.error('Manual optimization failed', { error: message, campaignDbId: id });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
