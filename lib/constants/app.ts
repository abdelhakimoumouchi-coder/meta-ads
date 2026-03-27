/**
 * Application-level constants derived from environment variables.
 *
 * All env parsing is centralised here.  The rest of the app imports these
 * constants instead of calling `process.env` directly, which makes it easy
 * to audit, validate, and mock for tests.
 *
 * Parsing is intentionally strict: missing required values throw at startup.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[config] Missing required environment variable: ${name}`);
  }
  return value;
}

function envString(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function envNumber(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`[config] Environment variable ${name} must be a number, got: "${raw}"`);
  }
  return parsed;
}

function envBoolean(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  return raw.toLowerCase() === 'true';
}

// ─── App ──────────────────────────────────────────────────────────────────────

export const APP_URL = envString('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');

export const NODE_ENV = envString('NODE_ENV', 'development');

export const IS_PRODUCTION = NODE_ENV === 'production';

/**
 * Secret token that every cron route requires in the Authorization header.
 * Required in all environments.
 */
export const CRON_SECRET = requireEnv('CRON_SECRET');

// ─── Database ─────────────────────────────────────────────────────────────────

export const DATABASE_URL = requireEnv('DATABASE_URL');

// ─── Budget configuration ─────────────────────────────────────────────────────

/** Total USD budget allocated for the entire campaign. Default: 180. */
export const TOTAL_CAMPAIGN_BUDGET = envNumber('TOTAL_CAMPAIGN_BUDGET', 180);

/** Number of days the campaign is scheduled to run. Default: 6. */
export const CAMPAIGN_DURATION_DAYS = envNumber('CAMPAIGN_DURATION_DAYS', 6);

/** Target daily spend in USD across all ads. Default: 30. */
export const BASE_DAILY_BUDGET = envNumber('BASE_DAILY_BUDGET', 30);

/**
 * Initial per-ad daily budget split as an array of USD amounts.
 * Must contain one value per active ad and sum to BASE_DAILY_BUDGET.
 * Default: [10, 10, 10].
 */
export const INITIAL_SPLIT: number[] = (() => {
  const raw = process.env.INITIAL_SPLIT ?? '10,10,10';
  return raw.split(',').map((s) => {
    const n = Number(s.trim());
    if (Number.isNaN(n)) throw new Error(`[config] INITIAL_SPLIT contains non-numeric value: "${s}"`);
    return n;
  });
})();

// ─── Optimization rules ───────────────────────────────────────────────────────

/** Minimum hours between two consecutive reallocations. Default: 48. */
export const MIN_REALLOCATION_INTERVAL_HOURS = envNumber('MIN_REALLOCATION_INTERVAL_HOURS', 48);

/** Minimum USD spent by an ad before it participates in reallocation. Default: 8. */
export const MIN_SPEND_BEFORE_DECISION = envNumber('MIN_SPEND_BEFORE_DECISION', 8);

/**
 * Maximum percentage of BASE_DAILY_BUDGET that can be shifted in one reallocation.
 * Default: 25 (i.e. 25 %).
 */
export const MAX_SINGLE_SHIFT_PERCENT = envNumber('MAX_SINGLE_SHIFT_PERCENT', 25);

/** Minimum daily USD budget allowed for any single ad. Default: 5. */
export const MIN_AD_DAILY_BUDGET = envNumber('MIN_AD_DAILY_BUDGET', 5);

/** Maximum daily USD budget allowed for any single ad. Default: 20. */
export const MAX_AD_DAILY_BUDGET = envNumber('MAX_AD_DAILY_BUDGET', 20);

// ─── Safety / pausing ─────────────────────────────────────────────────────────

/**
 * Percentage of total budget over which the overspend is considered critical.
 * E.g. 8 means "tolerate up to 8 % over expected spend before acting".
 */
export const OVERSPEND_BUFFER_PERCENT = envNumber('OVERSPEND_BUFFER_PERCENT', 8);

/** Automatically pause all ads when the total budget is fully consumed. */
export const AUTO_PAUSE_IF_BUDGET_REACHED = envBoolean('AUTO_PAUSE_IF_BUDGET_REACHED', true);

/** Automatically pause all ads when the campaign's end date is reached. */
export const AUTO_PAUSE_IF_CAMPAIGN_END_REACHED = envBoolean('AUTO_PAUSE_IF_CAMPAIGN_END_REACHED', true);

// ─── Mutation safety mode ─────────────────────────────────────────────────────

/**
 * Controls whether Meta API mutations (budget updates, ad pauses) are actually
 * executed or only simulated.  Set to "live" to allow real mutations; any other
 * value (including the default "dry-run") prevents writes to the Meta API.
 *
 * Example:
 *   META_MUTATION_MODE=live   → budgets / pauses are applied via Meta API
 *   META_MUTATION_MODE=dry-run (default) → mutations are logged but not applied
 */
export const META_MUTATION_MODE = envString('META_MUTATION_MODE', 'dry-run');

/**
 * True when mutations are in dry-run mode (no actual writes to Meta API).
 * Use IS_DRY_RUN as the single authoritative gate for all Meta API mutations.
 */
export const IS_DRY_RUN = META_MUTATION_MODE !== 'live';

