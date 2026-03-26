import { NextResponse } from 'next/server';
import { runOptimizer } from '../../../../lib/optimizer/decision-engine';
import { cronLogger as logger } from '../../../../lib/logs/logger';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  try {
    await logger.info('optimize-creatives cron started');

    const decision = await runOptimizer({ trigger: 'cron' });

    await logger.info('optimize-creatives cron complete', {
      reallocated: decision.reallocated,
      skipReason: decision.skipReason,
      adCount: decision.scores.length,
    });

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
    await logger.error('optimize-creatives cron failed', { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
