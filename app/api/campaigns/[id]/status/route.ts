import { NextRequest, NextResponse } from 'next/server';
import { findCampaignById } from '../../../../../lib/db/queries';
import prisma from '../../../../../lib/db/prisma';

export const dynamic = 'force-dynamic';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Stale if syncedAt is older than 24 hours. */
function isStaleSyncedAt(syncedAt: Date | null): boolean {
  if (!syncedAt) return true;
  return Date.now() - syncedAt.getTime() > 24 * 60 * 60 * 1_000;
}

// ─── GET /api/campaigns/[id]/status ──────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const campaign = await findCampaignById(id).catch(() => null);
  if (!campaign) {
    return NextResponse.json(
      { ok: false, error: 'Campaign not found' },
      { status: 404 },
    );
  }

  // ── Sync status ───────────────────────────────────────────────────────────
  const isSynced = campaign.syncedAt !== null;
  const isStale = isStaleSyncedAt(campaign.syncedAt);

  const sync = {
    syncedAt: campaign.syncedAt ?? null,
    isSynced,
    isStale,
  };

  // ── Budget ────────────────────────────────────────────────────────────────
  const budget = {
    dailyBudgetCents: campaign.dailyBudgetCents ?? null,
    lifetimeBudgetCents: campaign.lifetimeBudgetCents ?? null,
  };

  // ── Latest metrics ────────────────────────────────────────────────────────
  const latestMetricsRow = await prisma.adMetrics.findFirst({
    where: { campaignId: campaign.id },
    orderBy: { date: 'desc' },
    select: {
      date: true,
      impressions: true,
      clicks: true,
      spendCents: true,
      ctr: true,
      cpc: true,
      conversationsStarted: true,
    },
  });

  const latestMetrics = latestMetricsRow
    ? {
        date: latestMetricsRow.date,
        impressions: latestMetricsRow.impressions,
        clicks: latestMetricsRow.clicks,
        spendCents: latestMetricsRow.spendCents,
        ctr: latestMetricsRow.ctr,
        cpc: latestMetricsRow.cpc,
        conversationsStarted: latestMetricsRow.conversationsStarted,
      }
    : null;

  // ── Health warnings ───────────────────────────────────────────────────────
  const healthWarnings: string[] = [];
  if (!isSynced) {
    healthWarnings.push('NEVER_SYNCED');
  } else if (isStale) {
    healthWarnings.push('STALE_SYNC');
  }
  if (!latestMetrics) {
    healthWarnings.push('NO_METRICS');
  }

  return NextResponse.json({
    ok: true,
    campaign: {
      id: campaign.id,
      metaId: campaign.metaId,
      name: campaign.name,
      status: campaign.status,
      objectiveType: campaign.objectiveType,
      startDate: campaign.startDate,
      stopDate: campaign.stopDate,
    },
    sync,
    budget,
    latestMetrics,
    healthWarnings,
  });
}
