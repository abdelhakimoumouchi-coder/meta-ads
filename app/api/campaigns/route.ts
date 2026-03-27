/**
 * app/api/campaigns/route.ts
 *
 * GET  /api/campaigns  – list all campaigns with aggregate metrics
 * POST /api/campaigns  – import / create a campaign record
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '../../../lib/db/prisma';

export const dynamic = 'force-dynamic';

// ─── Validation schema ────────────────────────────────────────────────────────

const VALID_STATUSES = ['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED'] as const;

const CreateCampaignSchema = z.object({
  metaId: z.string().min(1, 'metaId is required'),
  name: z.string().min(1, 'name is required'),
  status: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.enum(VALID_STATUSES))
    .optional()
    .default('PAUSED'),
  objectiveType: z.string().min(1).optional().nullable(),
  dailyBudgetCents: z
    .number()
    .int('dailyBudgetCents must be an integer')
    .min(0, 'dailyBudgetCents must be >= 0')
    .max(100_000_00, 'dailyBudgetCents exceeds maximum ($1,000,000)')
    .optional()
    .nullable(),
  lifetimeBudgetCents: z
    .number()
    .int('lifetimeBudgetCents must be an integer')
    .min(0, 'lifetimeBudgetCents must be >= 0')
    .max(100_000_00, 'lifetimeBudgetCents exceeds maximum ($1,000,000)')
    .optional()
    .nullable(),
  startDate: z
    .string()
    .datetime({ message: 'startDate must be a valid ISO 8601 date string' })
    .optional()
    .nullable(),
  stopDate: z
    .string()
    .datetime({ message: 'stopDate must be a valid ISO 8601 date string' })
    .optional()
    .nullable(),
});

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
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateCampaignSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 },
    );
  }

  const {
    metaId,
    name,
    status,
    objectiveType,
    dailyBudgetCents,
    lifetimeBudgetCents,
    startDate,
    stopDate,
  } = parsed.data;

  try {
    const now = new Date();

    const campaign = await prisma.campaign.upsert({
      where: { metaId },
      create: {
        metaId,
        name,
        status,
        dailyBudgetCents: dailyBudgetCents ?? null,
        lifetimeBudgetCents: lifetimeBudgetCents ?? null,
        startDate: startDate ? new Date(startDate) : null,
        stopDate: stopDate ? new Date(stopDate) : null,
        objectiveType: objectiveType ?? null,
        syncedAt: now,
      },
      update: {
        name,
        status,
        dailyBudgetCents: dailyBudgetCents ?? null,
        lifetimeBudgetCents: lifetimeBudgetCents ?? null,
        startDate: startDate ? new Date(startDate) : null,
        stopDate: stopDate ? new Date(stopDate) : null,
        objectiveType: objectiveType ?? null,
        syncedAt: now,
      },
    });

    return NextResponse.json({ ok: true, campaign }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
