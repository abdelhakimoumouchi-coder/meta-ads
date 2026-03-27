import { NextResponse } from 'next/server';
import { findCampaignById } from '../../../../../lib/db/queries';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const campaign = await findCampaignById(id).catch(() => null);
  if (!campaign) {
    return NextResponse.json(
      { ok: false, error: 'Campaign not found' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    campaign: {
      id: campaign.id,
      metaId: campaign.metaId,
      name: campaign.name,
      status: campaign.status,
      dailyBudgetCents: campaign.dailyBudgetCents,
      lifetimeBudgetCents: campaign.lifetimeBudgetCents,
      startDate: campaign.startDate,
      stopDate: campaign.stopDate,
      objectiveType: campaign.objectiveType,
      syncedAt: campaign.syncedAt,
    },
  });
}
