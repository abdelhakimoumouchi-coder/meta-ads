/**
 * scripts/bootstrap.ts
 *
 * Local development bootstrap script.
 *
 * Run once after cloning the repo to:
 *   1. Validate environment variables
 *   2. Create / migrate the SQLite database
 *   3. Generate the Prisma client
 *   4. Seed the database with stub data
 *
 * Usage:
 *   cp .env.example .env          # fill in your credentials
 *   npm run bootstrap
 *
 * This script is safe to re-run — all steps are idempotent.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(command: string, label: string): void {
  console.log(`\n▶  ${label}`);
  try {
    execSync(command, { stdio: 'inherit', cwd: process.cwd() });
    console.log(`✓  ${label} — done`);
  } catch (err) {
    console.error(`✗  ${label} — FAILED`);
    throw err;
  }
}

function checkEnv(): void {
  console.log('\n▶  Checking required environment variables…');

  // Minimal set required for the app to start; detailed validation is in lib/constants/*.
  const required = [
    'DATABASE_URL',
    'CRON_SECRET',
    'META_APP_ID',
    'META_APP_SECRET',
    'META_ACCESS_TOKEN',
    'META_AD_ACCOUNT_ID',
    'META_CAMPAIGN_ID',
  ];

  const missing = required.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    console.warn(
      `\n⚠   The following environment variables are not set:\n  ${missing.join('\n  ')}\n`,
    );
    console.warn(
      '   Copy .env.example → .env and fill in your credentials before running the full app.\n',
    );
  } else {
    console.log('✓  All required environment variables are present.');
  }
}

function checkDotEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.warn('\n⚠   .env file not found.');
    console.warn('   Run:  cp .env.example .env  — then fill in your credentials.\n');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Meta Ads Optimizer — Bootstrap         ║');
  console.log('╚══════════════════════════════════════════╝\n');

  checkDotEnv();

  // Load .env if dotenv is available (best-effort — not a hard requirement)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config();
  } catch {
    // dotenv is optional at bootstrap time
  }

  checkEnv();

  // Generate Prisma client (must come before migrations)
  run('npx prisma generate', 'Prisma generate');

  // Push schema changes to the database (creates DB if it does not exist)
  run('npx prisma db push --skip-generate', 'Prisma DB push (migrate schema)');

  // Seed with stub data
  run('npx tsx prisma/seed.ts', 'Seed database');

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   Bootstrap complete! 🎉                  ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║   Next steps:                            ║');
  console.log('║     npm run dev        — start app       ║');
  console.log('║     npm run db:studio  — open Prisma UI  ║');
  console.log('║     npm run manual-sync — fetch Meta data ║');
  console.log('╚══════════════════════════════════════════╝\n');
}

main().catch((err) => {
  console.error('\n❌  Bootstrap failed:', err);
  process.exit(1);
});
