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
