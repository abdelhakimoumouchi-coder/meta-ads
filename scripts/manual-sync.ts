/**
 * scripts/manual-sync.ts
 *
 * Developer utility to manually trigger a full Meta API sync.
 *
 * Fetches campaign, ad set, ad, and insights data from the Meta API and
 * persists it to the local database.  Useful for:
 *   - Testing your Meta API credentials end-to-end
 *   - Bootstrapping real data before the cron job runs
 *   - Debugging sync issues without triggering the cron route
 *
 * Usage:
 *   npm run manual-sync
 *
 * Requires a valid .env with Meta credentials and DATABASE_URL.
 */

// Best-effort .env load for standalone script execution
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config();
} catch {
  // dotenv not installed — rely on shell environment
}

import { PrismaClient } from '@prisma/client';
import { fetchCampaign } from '../lib/meta/campaigns';
import { fetchCampaignAdSets } from '../lib/meta/adsets';
import { fetchCampaignAds } from '../lib/meta/ads';
import { fetchAdInsights, normaliseInsights } from '../lib/meta/insights';
import {
  upsertCampaign,
  upsertAdSet,
  upsertAd,
  upsertAdMetrics,
  createSyncRun,
  findCampaignByMetaId,
  findAdSetByMetaId,
  findAdByMetaId,
} from '../lib/db/queries';

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function elapsed(start: number): string {
  return `${Date.now() - start}ms`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const scriptStart = Date.now();

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Meta Ads Optimizer — Manual Sync       ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Validate that the critical env vars are present before hitting the API
  const metaCampaignId = process.env.META_CAMPAIGN_ID;
  if (!metaCampaignId) {
    console.error('❌  META_CAMPAIGN_ID is not set in .env — aborting.');
    process.exit(1);
  }

  let campaignDbId: string | null = null;

  try {
    // ── Step 1: Sync campaign ──────────────────────────────────────────────

    console.log('▶  Fetching campaign from Meta API…');
    const t1 = Date.now();
    const rawCampaign = await fetchCampaign();
    console.log(`   ✓  Campaign fetched in ${elapsed(t1)}: "${rawCampaign.name}"`);

    const campaign = await upsertCampaign({
      metaId: rawCampaign.id,
      name: rawCampaign.name,
      status: rawCampaign.status,
      dailyBudgetCents: rawCampaign.daily_budget
        ? parseInt(rawCampaign.daily_budget, 10)
        : null,
      lifetimeBudgetCents: rawCampaign.lifetime_budget
        ? parseInt(rawCampaign.lifetime_budget, 10)
        : null,
      startDate: rawCampaign.start_time ? new Date(rawCampaign.start_time) : null,
      stopDate: rawCampaign.stop_time ? new Date(rawCampaign.stop_time) : null,
      objectiveType: rawCampaign.objective ?? null,
      syncedAt: new Date(),
    });

    campaignDbId = campaign.id;
    console.log(`   ✓  Campaign saved: DB id = ${campaign.id}\n`);

    // ── Step 2: Sync ad sets ───────────────────────────────────────────────

    console.log('▶  Fetching ad sets from Meta API…');
    const t2 = Date.now();
    const rawAdSets = await fetchCampaignAdSets();
    console.log(`   ✓  ${rawAdSets.length} ad set(s) fetched in ${elapsed(t2)}`);

    for (const raw of rawAdSets) {
      const adSet = await upsertAdSet({
        metaId: raw.id,
        campaignId: campaign.id,
        name: raw.name,
        status: raw.status,
        dailyBudgetCents: parseInt(raw.daily_budget, 10),
        billingEvent: raw.billing_event ?? null,
        optimizationGoal: raw.optimization_goal ?? null,
        startTime: raw.start_time ? new Date(raw.start_time) : null,
        endTime: raw.end_time ? new Date(raw.end_time) : null,
        syncedAt: new Date(),
      });
      console.log(`   ✓  Ad set saved: "${adSet.name}" (${adSet.id})`);
    }

    console.log('');

    // ── Step 3: Sync ads ───────────────────────────────────────────────────

    console.log('▶  Fetching ads from Meta API…');
    const t3 = Date.now();
    const rawAds = await fetchCampaignAds();
    console.log(`   ✓  ${rawAds.length} ad(s) fetched in ${elapsed(t3)}`);

    for (const raw of rawAds) {
      // Look up the ad set DB id from the Meta ad set id
      const adSetRecord = await findAdSetByMetaId(raw.adset_id);
      if (!adSetRecord) {
        console.warn(`   ⚠   Ad set ${raw.adset_id} not found in DB — skipping ad ${raw.id}`);
        continue;
      }

      const ad = await upsertAd({
        metaId: raw.id,
        adSetId: adSetRecord.id,
        campaignId: campaign.id,
        name: raw.name,
        status: raw.status,
        creativeId: raw.creative?.id ?? null,
        syncedAt: new Date(),
      });
      console.log(`   ✓  Ad saved: "${ad.name}" (${ad.id})`);
    }

    console.log('');

    // ── Step 4: Sync insights ──────────────────────────────────────────────

    console.log('▶  Fetching insights from Meta API…');
    const t4 = Date.now();

    // Fetch insights for each ad in the campaign
    const dbAds = await prisma.ad.findMany({ where: { campaignId: campaign.id } });
    let totalRowsSaved = 0;

    for (const dbAd of dbAds) {
      const adRecord = await findAdByMetaId(dbAd.metaId);
      if (!adRecord) continue;

      try {
        const rawInsights = await fetchAdInsights(dbAd.metaId);
        const normalised = normaliseInsights(rawInsights);

        for (const metrics of normalised) {
          // Override adId with our DB id (normalised row uses Meta ad id)
          await upsertAdMetrics({
            adId: adRecord.id,
            campaignId: campaign.id,
            date: metrics.date,
            impressions: metrics.impressions,
            clicks: metrics.clicks,
            linkClicks: metrics.linkClicks,
            spendCents: Math.round(metrics.spendUsd * 100),
            reach: metrics.reach,
            frequency: metrics.frequency,
            cpm: metrics.cpm,
            ctr: metrics.ctr,
            cpc: metrics.cpc,
            conversationsStarted: metrics.conversationsStarted,
            costPerConversationCents: Math.round(metrics.costPerConversationUsd * 100),
            videoPct25: metrics.videoPct25,
            videoPct50: metrics.videoPct50,
            videoPct75: metrics.videoPct75,
            videoPct100: metrics.videoPct100,
            videoThruPlays: metrics.videoThruPlays,
            outboundClicks: metrics.outboundClicks,
            outboundCtr: metrics.outboundCtr,
            reactions: metrics.reactions,
            comments: metrics.comments,
            shares: metrics.shares,
          });
          totalRowsSaved++;
        }

        console.log(
          `   ✓  "${dbAd.name}": ${normalised.length} day(s) of insights saved`,
        );
      } catch (err) {
        console.warn(`   ⚠   Insights fetch failed for ad ${dbAd.metaId}:`, err);
      }
    }

    const syncDuration = Date.now() - scriptStart;
    console.log(
      `\n   ✓  ${totalRowsSaved} insight row(s) saved in ${elapsed(t4)}\n`,
    );

    // ── Step 5: Log sync run ───────────────────────────────────────────────

    await createSyncRun({
      campaignId: campaign.id,
      success: true,
      errorMessage: null,
      durationMs: syncDuration,
    });

    console.log('╔══════════════════════════════════════════╗');
    console.log('║   Sync complete! ✅                       ║');
    console.log(`║   Duration: ${String(syncDuration).padEnd(28)}║`);
    console.log(`║   Campaign DB ID:                        ║`);
    console.log(`║   ${campaign.id.substring(0, 40).padEnd(40)} ║`);
    console.log('╚══════════════════════════════════════════╝\n');

  } catch (err) {
    const syncDuration = Date.now() - scriptStart;

    console.error('\n❌  Sync failed:', err);

    // Log failure to DB if we at least got the campaign id
    if (campaignDbId) {
      try {
        await createSyncRun({
          campaignId: campaignDbId,
          success: false,
          errorMessage: err instanceof Error ? err.message : String(err),
          durationMs: syncDuration,
        });
      } catch {
        // ignore secondary failure
      }
    }

    process.exit(1);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
