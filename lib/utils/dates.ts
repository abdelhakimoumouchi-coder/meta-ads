/**
 * Date and campaign-day helpers.
 *
 * All functions are pure and deterministic (accept an explicit `now` parameter
 * rather than calling `new Date()` internally) so they are easy to test.
 */

import { CAMPAIGN_DURATION_DAYS } from '../constants/app';

// ─── Basic helpers ────────────────────────────────────────────────────────────

/**
 * Returns the UTC midnight of the given date.
 * Useful for bucketing metrics into calendar days.
 */
export function toUtcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

/**
 * Returns the number of whole calendar days elapsed between two dates.
 * `start` is treated as day 0.
 */
export function daysBetween(start: Date, end: Date): number {
  const msPerDay = 86_400_000;
  const startMs = toUtcMidnight(start).getTime();
  const endMs = toUtcMidnight(end).getTime();
  return Math.floor((endMs - startMs) / msPerDay);
}

/**
 * Returns the elapsed fractional days from `start` to `now`.
 * More precise than `daysBetween` — suitable for pacing calculations.
 */
export function elapsedDays(start: Date, now: Date): number {
  const msPerDay = 86_400_000;
  return Math.max(0, (now.getTime() - start.getTime()) / msPerDay);
}

// ─── Campaign helpers ─────────────────────────────────────────────────────────

/**
 * Returns the number of remaining days (fractional) in the campaign.
 * Returns 0 if the campaign has already ended.
 */
export function campaignDaysRemaining(
  startDate: Date,
  now: Date,
  durationDays: number = CAMPAIGN_DURATION_DAYS
): number {
  const elapsed = elapsedDays(startDate, now);
  return Math.max(0, durationDays - elapsed);
}

/**
 * Returns the campaign's expected end date given a start date and duration.
 */
export function campaignEndDate(
  startDate: Date,
  durationDays: number = CAMPAIGN_DURATION_DAYS
): Date {
  return new Date(startDate.getTime() + durationDays * 86_400_000);
}

/**
 * Returns true if the campaign has reached or passed its end date.
 */
export function isCampaignOver(
  startDate: Date,
  now: Date,
  durationDays: number = CAMPAIGN_DURATION_DAYS
): boolean {
  return campaignDaysRemaining(startDate, now, durationDays) <= 0;
}

/**
 * Returns true if enough time has elapsed since the last optimization run
 * to allow another reallocation (i.e. ≥ minIntervalHours have passed).
 */
export function isOptimizationAllowed(
  lastOptimizedAt: Date | null,
  now: Date,
  minIntervalHours: number
): boolean {
  if (lastOptimizedAt === null) return true;
  const elapsedHours = (now.getTime() - lastOptimizedAt.getTime()) / 3_600_000;
  return elapsedHours >= minIntervalHours;
}

/**
 * Formats a Date as an ISO-8601 date string (`YYYY-MM-DD`) in UTC.
 */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Parses an ISO date string (`YYYY-MM-DD`) to a UTC midnight Date.
 * Throws if the string is not a valid date.
 */
export function fromIsoDate(dateString: string): Date {
  const d = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`[dates] Invalid date string: "${dateString}"`);
  }
  return d;
}

/**
 * Returns a human-readable relative time string, e.g. "2 days ago".
 * Suitable for display in the dashboard.
 */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.round(diffMs / 1_000);
  const diffMin = Math.round(diffSec / 60);
  const diffHours = Math.round(diffMin / 60);
  const diffDays = Math.round(diffHours / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}
