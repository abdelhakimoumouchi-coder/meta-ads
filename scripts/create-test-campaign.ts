/**
 * scripts/create-test-campaign.ts
 *
 * Developer utility to create a stub campaign entry in the local database
 * WITHOUT calling the Meta API.
 *
 * Useful when you have no real campaign yet and want to test the dashboard,
 * optimizer, and budget guard against realistic-looking local data.
 *
 * Usage:
 *   npm run create-test-campaign
 *
 * The script is idempotent — re-running updates the existing record.
 *
 * To target a different campaign, set TEST_CAMPAIGN_META_ID in your .env.
 */

import { PrismaClient } from '@prisma/client';

// Best-effort .env load for standalone script execution
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config();
} catch {
  // dotenv not installed — rely on shell environment
}

const prisma = new PrismaClient();

// ─── Configuration ────────────────────────────────────────────────────────────

const TEST_CAMPAIGN_META_ID =
  process.env.TEST_CAMPAIGN_META_ID ?? 'test_campaign_local_001';

const TOTAL_BUDGET_USD = 180;
const DURATION_DAYS = 6;
const DAILY_BUDGET_PER_AD_USD = 10;
const AD_COUNT = 3;

const now = new Date();
const startDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // started yesterday
const stopDate = new Date(startDate.getTime() + DURATION_DAYS * 24 * 60 * 60 * 1000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate plausible daily metrics for an ad creative.
 * Higher `performanceTier` (0–2) yields better stats.
 */
function generateDayMetrics(
  performanceTier: number,
): {
  impressions: number;
  clicks: number;
  conversationsStarted: number;
  videoPct25: number;
  videoPct50: number;
  videoPct75: number;
  videoPct100: number;
  videoThruPlays: number;
  outboundClicks: number;
  reactions: number;
} {
  const impressionBase = 1_000 + performanceTier * 200;
  const impressions = randomBetween(impressionBase, impressionBase + 300);
  const ctrBase = 0.03 + performanceTier * 0.01;
  const clicks = Math.round(impressions * (ctrBase + Math.random() * 0.01));
  const convRate = 0.05 + performanceTier * 0.03;
  const conversationsStarted = Math.round(clicks * (convRate + Math.random() * 0.02));

  // Video retention — better tier = better retention
  const retentionBase = 0.6 + performanceTier * 0.1;
  const videoPct25 = Math.round(impressions * (retentionBase + 0.05));
  const videoPct50 = Math.round(videoPct25 * (0.75 + performanceTier * 0.05));
  const videoPct75 = Math.round(videoPct50 * (0.65 + performanceTier * 0.05));
  const videoPct100 = Math.round(videoPct75 * (0.5 + performanceTier * 0.05));
  const videoThruPlays = Math.round(videoPct100 * 0.9);

  const outboundClicks = Math.round(clicks * 0.7);
  const reactions = randomBetween(5 + performanceTier * 3, 15 + performanceTier * 5);

  return {
    impressions,
    clicks,
    conversationsStarted,
    videoPct25,
    videoPct50,
    videoPct75,
    videoPct100,
    videoThruPlays,
    outboundClicks,
    reactions,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   Meta Ads Optimizer — Create Test Campaign   ║');
  console.log('╚═══════════════════════════════════════════════╝\n');

  // ── Campaign ────────────────────────────────────────────────────────────────

  const campaign = await prisma.campaign.upsert({
    where: { metaId: TEST_CAMPAIGN_META_ID },
    create: {
      metaId: TEST_CAMPAIGN_META_ID,
      name: '[TEST] Local Development Campaign',
      status: 'ACTIVE',
      dailyBudgetCents: null,
      lifetimeBudgetCents: TOTAL_BUDGET_USD * 100,
      startDate,
      stopDate,
      objectiveType: 'MESSAGES',
      syncedAt: now,
    },
    update: {
      name: '[TEST] Local Development Campaign',
      status: 'ACTIVE',
      lifetimeBudgetCents: TOTAL_BUDGET_USD * 100,
      startDate,
      stopDate,
      syncedAt: now,
    },
  });

  console.log(`✓  Campaign created/updated: ${campaign.id}`);
  console.log(`   Meta ID: ${campaign.metaId}`);
  console.log(`   Budget: $${TOTAL_BUDGET_USD} over ${DURATION_DAYS} days`);
  console.log(`   Period: ${startDate.toDateString()} → ${stopDate.toDateString()}\n`);

  // ── Ad sets and ads ─────────────────────────────────────────────────────────

  const creatives = [
    { label: 'A', tier: 0 }, // worst performer
    { label: 'B', tier: 2 }, // best performer
    { label: 'C', tier: 1 }, // mid performer
  ];

  for (let i = 0; i < AD_COUNT; i++) {
    const { label, tier } = creatives[i];

    const adSet = await prisma.adSet.upsert({
      where: { metaId: `${TEST_CAMPAIGN_META_ID}_adset_${label.toLowerCase()}` },
      create: {
        metaId: `${TEST_CAMPAIGN_META_ID}_adset_${label.toLowerCase()}`,
        campaignId: campaign.id,
        name: `[TEST] Ad Set ${label}`,
        status: 'ACTIVE',
        dailyBudgetCents: DAILY_BUDGET_PER_AD_USD * 100,
        billingEvent: 'IMPRESSIONS',
        optimizationGoal: 'CONVERSATIONS',
        startTime: startDate,
        endTime: stopDate,
        syncedAt: now,
      },
      update: {
        status: 'ACTIVE',
        dailyBudgetCents: DAILY_BUDGET_PER_AD_USD * 100,
        syncedAt: now,
      },
    });

    const ad = await prisma.ad.upsert({
      where: { metaId: `${TEST_CAMPAIGN_META_ID}_ad_${label.toLowerCase()}` },
      create: {
        metaId: `${TEST_CAMPAIGN_META_ID}_ad_${label.toLowerCase()}`,
        adSetId: adSet.id,
        campaignId: campaign.id,
        name: `[TEST] Creative ${label}`,
        status: 'ACTIVE',
        creativeId: null,
        syncedAt: now,
      },
      update: {
        status: 'ACTIVE',
        syncedAt: now,
      },
    });

    console.log(`✓  Ad Set ${label}: ${adSet.id}  |  Ad ${label}: ${ad.id}`);

    // Generate 1 day of metrics (yesterday)
    const spendCents = (DAILY_BUDGET_PER_AD_USD - 0.5 + Math.random()) * 100;
    const m = generateDayMetrics(tier);
    const cpm = m.impressions > 0 ? (spendCents / 100 / m.impressions) * 1000 : 0;
    const ctr = m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0;
    const cpc = m.clicks > 0 ? spendCents / 100 / m.clicks : 0;
    const costPerConvCents =
      m.conversationsStarted > 0
        ? Math.round(spendCents / m.conversationsStarted)
        : 0;
    const outboundCtr =
      m.impressions > 0 ? (m.outboundClicks / m.impressions) * 100 : 0;

    await prisma.adMetrics.upsert({
      where: { adId_date: { adId: ad.id, date: startDate } },
      create: {
        adId: ad.id,
        campaignId: campaign.id,
        date: startDate,
        impressions: m.impressions,
        clicks: m.clicks,
        linkClicks: m.clicks,
        spendCents: Math.round(spendCents),
        reach: Math.round(m.impressions * 0.87),
        frequency: 1.15 + Math.random() * 0.1,
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
        comments: Math.floor(m.reactions * 0.25),
        shares: Math.floor(m.reactions * 0.08),
      },
      update: {
        impressions: m.impressions,
        clicks: m.clicks,
        spendCents: Math.round(spendCents),
        conversationsStarted: m.conversationsStarted,
      },
    });

    console.log(
      `   ↳  Metrics: ${m.impressions} impressions, ${m.conversationsStarted} conversations, $${(spendCents / 100).toFixed(2)} spend`,
    );
  }

  console.log('\n✅  Test campaign ready.');
  console.log('   Run `npm run dev` to see it in the dashboard.');
  console.log(
    `   Campaign ID (internal): ${campaign.id}\n`,
  );
}

main()
  .catch((err) => {
    console.error('❌  Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
