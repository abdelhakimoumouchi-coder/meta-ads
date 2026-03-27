/**
 * app/api/campaigns/route.ts
 *
 * GET  /api/campaigns  – list all campaigns with aggregate metrics
 * POST /api/campaigns  – import / create a campaign record
 */

import { NextResponse } from 'next/server';
import prisma from '../../../lib/db/prisma';

export const dynamic = 'force-dynamic';

// ─── GET /api/campaigns ───────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // Aggregate metrics per campaign in parallel.
    const results = await Promise.all(
      campaigns.map(async (c) => {
        const [metricsAgg, latestMetrics] = await Promise.all([
          prisma.adMetrics.aggregate({
            where: { campaignId: c.id },
            _sum: {
              spendCents: true,
              impressions: true,
              clicks: true,
              conversationsStarted: true,
            },
          }),
          prisma.adMetrics.findFirst({
            where: { campaignId: c.id },
            orderBy: { date: 'desc' },
            select: { date: true },
          }),
        ]);

        return {
          id: c.id,
          metaId: c.metaId,
          name: c.name,
          status: c.status,
          dailyBudgetCents: c.dailyBudgetCents,
          lifetimeBudgetCents: c.lifetimeBudgetCents,
          startDate: c.startDate,
          stopDate: c.stopDate,
          objectiveType: c.objectiveType,
          syncedAt: c.syncedAt,
          metrics: {
            totalSpendCents: metricsAgg._sum.spendCents ?? 0,
            totalImpressions: metricsAgg._sum.impressions ?? 0,
            totalClicks: metricsAgg._sum.clicks ?? 0,
            totalConversations: metricsAgg._sum.conversationsStarted ?? 0,
            latestMetricsDate: latestMetrics?.date ?? null,
          },
        };
      }),
    );

    return NextResponse.json({ ok: true, campaigns: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ─── POST /api/campaigns ──────────────────────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    // Validate required fields.
    const metaId =
      typeof body.metaId === 'string' ? body.metaId.trim() : '';
    const name =
      typeof body.name === 'string' ? body.name.trim() : '';

    if (!metaId) {
      return NextResponse.json(
        { ok: false, error: 'metaId is required' },
        { status: 400 },
      );
    }
    if (!name) {
      return NextResponse.json(
        { ok: false, error: 'name is required' },
        { status: 400 },
      );
    }

    // Parse optional numeric / date fields.
    const dailyBudgetCents =
      typeof body.dailyBudgetCents === 'number' && body.dailyBudgetCents >= 0
        ? body.dailyBudgetCents
        : null;
    const lifetimeBudgetCents =
      typeof body.lifetimeBudgetCents === 'number' && body.lifetimeBudgetCents >= 0
        ? body.lifetimeBudgetCents
        : null;
    const startDate =
      typeof body.startDate === 'string' ? new Date(body.startDate) : null;
    const stopDate =
      typeof body.stopDate === 'string' ? new Date(body.stopDate) : null;
    const status =
      typeof body.status === 'string' ? body.status.toUpperCase() : 'PAUSED';
    const objectiveType =
      typeof body.objectiveType === 'string' ? body.objectiveType : null;

    const now = new Date();

    const campaign = await prisma.campaign.upsert({
      where: { metaId },
      create: {
        metaId,
        name,
        status,
        dailyBudgetCents,
        lifetimeBudgetCents,
        startDate,
        stopDate,
        objectiveType,
        syncedAt: now,
      },
      update: {
        name,
        status,
        dailyBudgetCents,
        lifetimeBudgetCents,
        startDate,
        stopDate,
        objectiveType,
        syncedAt: now,
      },
    });

    return NextResponse.json({ ok: true, campaign }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
