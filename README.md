# Meta Ads Optimizer

> A private internal control tool for optimising a single Meta Ads campaign across 3 ad creatives with strict budget safety, intelligent scoring, and automated 48-hour reallocations.

---

## Overview

This app connects to the **Meta Marketing API**, scores creative performance, and reallocates daily budgets conservatively — never exceeding the total campaign budget and never reacting to noisy short-term data.

It is **not** a multi-tenant SaaS product. It is purpose-built for one ad account.

---

## Architecture

```
app/                    Next.js App Router pages & API routes
├── api/
│   ├── meta/           Meta webhook & OAuth helpers
│   ├── campaigns/      Campaign status, budget, & manual optimise endpoints
│   └── cron/           Cron-protected: sync-metrics, optimise-creatives, budget-guard
components/             React UI components (server-first)
lib/
├── constants/          All business-rule constants (budget, scoring, meta, app)
├── utils/              Pure helper functions (dates, math, money, format, guards)
├── meta/               Meta API client & entity helpers
├── budget/             Pacing, safety limits, budget arithmetic
├── optimizer/          Scoring model, decision engine, reallocation logic
├── sync/               Fetch-and-persist logic for Meta entities & metrics
├── db/                 Prisma client singleton & typed query helpers
└── logs/               Structured logger
prisma/                 Prisma schema (SQLite) + seed
types/                  Shared TypeScript types (campaign, meta, metrics, optimizer, db)
scripts/                Bootstrap, manual-sync, and test-campaign helpers
```

---

## Business Rules

| Rule | Value |
|---|---|
| Campaign duration | 6 days |
| Total budget cap | 180 USD |
| Daily pacing target | 30 USD |
| Initial per-ad split | 10 / 10 / 10 USD |
| Min reallocation interval | 48 hours |
| Min spend before decision | 8 USD |
| Max single shift per cycle | 25 % |
| Min per-ad daily budget | 5 USD |
| Max per-ad daily budget | 20 USD |
| Overspend buffer | 8 % |

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in all values.

```bash
cp .env.example .env.local
```

See `.env.example` for a fully documented list of every variable, grouped by section.

**Required before first run:**
- `META_ACCESS_TOKEN` — long-lived system user token
- `META_AD_ACCOUNT_ID` — your ad account ID (`act_` prefix required)
- `META_CAMPAIGN_ID` — the single campaign this app controls
- `META_AD_IDS` — comma-separated ad IDs (one per creative)
- `CRON_SECRET` — random secret to protect cron routes

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env.local
# … fill in values …

# 3. Set up database
npx prisma generate
npx prisma db push
npx prisma db seed   # optional: seed test data

# 4. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Prisma / Database

```bash
# Generate Prisma client after schema changes
npx prisma generate

# Apply schema to local SQLite DB (no migration file)
npx prisma db push

# Open Prisma Studio
npx prisma studio

# Seed initial data
npx prisma db seed
```

---

## Cron Routes

All cron routes are protected by the `CRON_SECRET` environment variable.

Every request must include the header:
```
Authorization: Bearer <CRON_SECRET>
```

| Route | Purpose |
|---|---|
| `POST /api/cron/sync-metrics` | Fetch latest Meta data & persist |
| `POST /api/cron/optimize-creatives` | Score creatives & reallocate budgets |
| `POST /api/cron/budget-guard` | Evaluate pacing & apply safety actions |

Configure these in `vercel.json` to run on a schedule (e.g. every 6 hours).

---

## Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

Set all environment variables in the Vercel dashboard under **Settings → Environment Variables**.

> **Note:** Vercel Cron Jobs require a Pro plan. The app falls back gracefully if cron jobs are not configured — you can trigger routes manually.

---

## Manual Scripts

```bash
# Bootstrap: verify env & DB connectivity
npx ts-node scripts/bootstrap.ts

# Manual sync: pull latest Meta data
npx ts-node scripts/manual-sync.ts

# Create test campaign data (local dev only)
npx ts-node scripts/create-test-campaign.ts
```

---

## Scoring Model

Creatives are scored on 5 weighted dimensions (in priority order):

1. **Messaging performance** — conversations started, cost per conversation
2. **Video quality / retention** — ThruPlay rate, 15-second view rate
3. **CTR / click quality** — outbound CTR, link click rate
4. **Engagement** — reactions, comments, shares
5. **Stability / confidence** — data volume dampener (prevents overreacting to small samples)

Scores are normalised 0–1 per dimension and combined into a final weighted score.

---

## Limitations

- Single ad account / single campaign only.
- Optimisation only runs if ≥ 48 hours have elapsed since the last reallocation.
- Creatives are never fully paused by the optimizer during the campaign (manual override only).
- SQLite is used for local dev. For production, migrate the `DATABASE_URL` to a persistent store (e.g. Neon, Supabase, or Turso).
- Meta API rate limits apply; aggressive cron schedules may hit limits.
