/**
 * Display formatting utilities.
 *
 * Pure functions for formatting numbers, currencies, and percentages
 * for display in the dashboard.  These never throw — they return
 * a safe fallback string on invalid input.
 *
 * Monetary convention used throughout the codebase:
 *   - Fields/variables suffixed with `Usd` are in whole USD (e.g. 30.5).
 *   - Fields/variables suffixed with `Cents` are in integer cents (e.g. 3050).
 * This distinction is maintained in types, DB records, and helper functions.
 */

// ─── Currency ─────────────────────────────────────────────────────────────────

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USD_COMPACT_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/**
 * Formats a USD amount.  E.g. `formatUsd(30)` → `"$30.00"`.
 */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '$—';
  return USD_FORMATTER.format(amount);
}

/**
 * Formats a USD amount without unnecessary trailing zeros.
 * E.g. `formatUsdCompact(30)` → `"$30"`, `formatUsdCompact(30.5)` → `"$30.50"`.
 */
export function formatUsdCompact(amount: number): string {
  if (!Number.isFinite(amount)) return '$—';
  return USD_COMPACT_FORMATTER.format(amount);
}

/**
 * Formats USD cents as a dollar amount.
 * E.g. `formatCents(3050)` → `"$30.50"`.
 */
export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return '$—';
  return USD_FORMATTER.format(cents / 100);
}

// ─── Percentages ─────────────────────────────────────────────────────────────

/**
 * Formats a percentage value (0–100 range).
 * E.g. `formatPct(12.5)` → `"12.50%"`.
 */
export function formatPct(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—%';
  return `${value.toFixed(decimals)}%`;
}

/**
 * Formats a fraction (0–1 range) as a percentage string.
 * E.g. `formatFraction(0.125)` → `"12.50%"`.
 */
export function formatFraction(value: number, decimals = 2): string {
  return formatPct(value * 100, decimals);
}

// ─── Numbers ──────────────────────────────────────────────────────────────────

/**
 * Formats a plain number with thousands separators.
 * E.g. `formatNumber(1234567)` → `"1,234,567"`.
 */
export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Formats a number with a compact suffix (K, M, B).
 * E.g. `formatCompact(12500)` → `"12.5K"`.
 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(value);
}

// ─── Scores ───────────────────────────────────────────────────────────────────

/**
 * Formats a normalised score (0–1) as a 0–100 display value rounded to 1 decimal.
 * E.g. `formatScore(0.837)` → `"83.7"`.
 */
export function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '—';
  return (score * 100).toFixed(1);
}

// ─── Duration ────────────────────────────────────────────────────────────────

/**
 * Formats a fractional number of days as a human-readable string.
 * E.g. `formatDaysRemaining(1.5)` → `"1.5 days"`.
 */
export function formatDaysRemaining(days: number): string {
  if (!Number.isFinite(days) || days < 0) return '0 days';
  return `${days.toFixed(1)} day${days === 1 ? '' : 's'}`;
}
