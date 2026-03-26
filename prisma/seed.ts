/**
 * prisma/seed.ts
 *
 * Database seed for local development.
 *
 * Creates a realistic stub campaign, ad sets, and ads that match the
 * production data shape without requiring real Meta API credentials.
 *
 * Run:  npx tsx prisma/seed.ts
 *   or: npm run db:seed
 *
 * The seed is idempotent — running it multiple times is safe (upsert).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Seed data ────────────────────────────────────────────────────────────────

/** Fake Meta IDs used in development. Never used against the real API. */
const SEED_CAMPAIGN_META_ID = 'seed_campaign_001';
const SEED_ADSET_META_IDS = [
  'seed_adset_001',
  'seed_adset_002',
  'seed_adset_003',
] as const;
const SEED_AD_META_IDS = [
  'seed_ad_001',
  'seed_ad_002',
  'seed_ad_003',
] as const;

const now = new Date();
/** Campaign start: yesterday */
const startDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
/** Campaign stop: 5 days from now */
const stopDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

async function main(): Promise<void> {
  console.log('🌱  Seeding database…');

  // ── Campaign ──────────────────────────────────────────────────────────────

  const campaign = await prisma.campaign.upsert({
    where: { metaId: SEED_CAMPAIGN_META_ID },
    create: {
      metaId: SEED_CAMPAIGN_META_ID,
      name: '[SEED] Meta Ads Optimizer Campaign',
      status: 'ACTIVE',
      dailyBudgetCents: null,
      lifetimeBudgetCents: 18_000, // $180.00
      startDate,
      stopDate,
      objectiveType: 'MESSAGES',
      syncedAt: now,
    },
    update: {
      name: '[SEED] Meta Ads Optimizer Campaign',
      status: 'ACTIVE',
      lifetimeBudgetCents: 18_000,
      startDate,
      stopDate,
      syncedAt: now,
    },
  });

  console.log(`  ✓  Campaign: ${campaign.id} (${campaign.name})`);

  // ── Ad sets (one per creative) ────────────────────────────────────────────

  const adSetData = [
    { metaId: SEED_ADSET_META_IDS[0], name: '[SEED] Ad Set A', budget: 1_000 },
    { metaId: SEED_ADSET_META_IDS[1], name: '[SEED] Ad Set B', budget: 1_000 },
    { metaId: SEED_ADSET_META_IDS[2], name: '[SEED] Ad Set C', budget: 1_000 },
  ];

  const adSets = await Promise.all(
    adSetData.map(({ metaId, name, budget }) =>
      prisma.adSet.upsert({
        where: { metaId },
        create: {
          metaId,
          campaignId: campaign.id,
          name,
          status: 'ACTIVE',
          dailyBudgetCents: budget, // $10.00
          billingEvent: 'IMPRESSIONS',
          optimizationGoal: 'CONVERSATIONS',
          startTime: startDate,
          endTime: stopDate,
          syncedAt: now,
        },
        update: {
          name,
          status: 'ACTIVE',
          dailyBudgetCents: budget,
          syncedAt: now,
        },
      }),
    ),
  );

  for (const adSet of adSets) {
    console.log(`  ✓  Ad Set: ${adSet.id} (${adSet.name})`);
  }

  // ── Ads ───────────────────────────────────────────────────────────────────

  const adData = [
    { metaId: SEED_AD_META_IDS[0], name: '[SEED] Ad Creative A', adSetIdx: 0 },
    { metaId: SEED_AD_META_IDS[1], name: '[SEED] Ad Creative B', adSetIdx: 1 },
    { metaId: SEED_AD_META_IDS[2], name: '[SEED] Ad Creative C', adSetIdx: 2 },
  ];

  for (const { metaId, name, adSetIdx } of adData) {
    const adSet = adSets[adSetIdx];
    const ad = await prisma.ad.upsert({
      where: { metaId },
      create: {
        metaId,
        adSetId: adSet.id,
        campaignId: campaign.id,
        name,
        status: 'ACTIVE',
        creativeId: null,
        syncedAt: now,
      },
      update: {
        name,
        status: 'ACTIVE',
        syncedAt: now,
      },
    });
    console.log(`  ✓  Ad: ${ad.id} (${ad.name})`);

    // ── Seed 2 days of mock metrics ────────────────────────────────────────

    const metricsRows = [
      {
        date: startDate,
        impressions: 1_200 + adSetIdx * 150,
        clicks: 48 + adSetIdx * 5,
        spendCents: 950 + adSetIdx * 50, // ~$9.50
        conversationsStarted: 3 + adSetIdx,
        videoPct25: 800,
        videoPct50: 600,
        videoPct75: 400,
        videoPct100: 200,
        videoThruPlays: 150,
        outboundClicks: 30 + adSetIdx * 3,
        reactions: 10 + adSetIdx,
      },
      {
        date: new Date(startDate.getTime() + 24 * 60 * 60 * 1000),
        impressions: 1_350 + adSetIdx * 120,
        clicks: 54 + adSetIdx * 6,
        spendCents: 980 + adSetIdx * 40,
        conversationsStarted: 4 + adSetIdx,
        videoPct25: 900,
        videoPct50: 680,
        videoPct75: 450,
        videoPct100: 220,
        videoThruPlays: 170,
        outboundClicks: 34 + adSetIdx * 3,
        reactions: 12 + adSetIdx,
      },
    ];

    for (const m of metricsRows) {
      const cpm = m.impressions > 0 ? (m.spendCents / 100 / m.impressions) * 1000 : 0;
      const ctr = m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0;
      const cpc = m.clicks > 0 ? m.spendCents / 100 / m.clicks : 0;
      const costPerConvCents =
        m.conversationsStarted > 0
          ? Math.round((m.spendCents / m.conversationsStarted))
          : 0;
      const outboundCtr =
        m.impressions > 0 ? (m.outboundClicks / m.impressions) * 100 : 0;

      await prisma.adMetrics.upsert({
        where: { adId_date: { adId: ad.id, date: m.date } },
        create: {
          adId: ad.id,
          campaignId: campaign.id,
          date: m.date,
          impressions: m.impressions,
          clicks: m.clicks,
          linkClicks: m.clicks,
          spendCents: m.spendCents,
          reach: Math.round(m.impressions * 0.85),
          frequency: 1.18,
          cpm,
          ctr,
          cpc,
          conversationsStarted: m.conversationsStarted,
          costPerConversationCents: costPerConvCents,
          videoPct25: m.videoPct25,
          videoPct50: m.videoPct50,
          videoPct75: m.videoPct75,
          videoPct100: m.videoPct100,
          videoThruPlays: m.videoThruPlays,
          outboundClicks: m.outboundClicks,
          outboundCtr,
          reactions: m.reactions,
          comments: Math.floor(m.reactions * 0.3),
          shares: Math.floor(m.reactions * 0.1),
        },
        update: {
          impressions: m.impressions,
          clicks: m.clicks,
          spendCents: m.spendCents,
          conversationsStarted: m.conversationsStarted,
        },
      });
    }

    console.log(`    ✓  Seeded ${metricsRows.length} days of metrics for ${name}`);
  }

  // ── System log entry ───────────────────────────────────────────────────────

  await prisma.systemLog.create({
    data: {
      level: 'info',
      context: 'seed',
      message: 'Database seeded successfully',
      metaJson: JSON.stringify({ campaignId: campaign.id, seededAt: now }),
    },
  });

  console.log('\n✅  Seed complete.');
}

main()
  .catch((err) => {
    console.error('❌  Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
