/**
 * Type guards and defensive validators.
 *
 * Use these to narrow unknown values before processing, validate API responses,
 * and provide safe fallbacks when data may be missing or malformed.
 */

import type { MetaApiErrorResponse, MetaApiError } from '../../types/meta';
import type { CampaignStatus, AdStatus, AdSetStatus } from '../../types/campaign';
import type { PacingState } from '../../types/optimizer';

// ─── Primitive guards ─────────────────────────────────────────────────────────

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isPositiveNumber(value: unknown): value is number {
  return isNumber(value) && value > 0;
}

export function isNonNegativeNumber(value: unknown): value is number {
  return isNumber(value) && value >= 0;
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// ─── Meta API error guard ────────────────────────────────────────────────────

/**
 * Returns true if the given value is a Meta API error response object.
 */
export function isMetaApiError(value: unknown): value is MetaApiErrorResponse {
  if (!isObject(value)) return false;
  const maybeError = (value as unknown as MetaApiErrorResponse).error;
  return isObject(maybeError as unknown) && isNonEmptyString((maybeError as MetaApiError).message);
}

// ─── Status guards ────────────────────────────────────────────────────────────

const CAMPAIGN_STATUSES: CampaignStatus[] = ['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED'];
const ADSET_STATUSES: AdSetStatus[] = ['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED'];
const AD_STATUSES: AdStatus[] = [
  'ACTIVE',
  'PAUSED',
  'DELETED',
  'ARCHIVED',
  'DISAPPROVED',
  'PENDING_REVIEW',
];
const PACING_STATES: PacingState[] = [
  'UNDER_PACING',
  'ON_TRACK',
  'OVER_PACING',
  'DANGER',
];

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return isString(value) && (CAMPAIGN_STATUSES as string[]).includes(value);
}

export function isAdSetStatus(value: unknown): value is AdSetStatus {
  return isString(value) && (ADSET_STATUSES as string[]).includes(value);
}

export function isAdStatus(value: unknown): value is AdStatus {
  return isString(value) && (AD_STATUSES as string[]).includes(value);
}

export function isPacingState(value: unknown): value is PacingState {
  return isString(value) && (PACING_STATES as string[]).includes(value);
}

// ─── Safe parsers ─────────────────────────────────────────────────────────────

/**
 * Parses a value that may be a number or a numeric string (as Meta API returns).
 * Returns the parsed number, or `fallback` if parsing fails.
 */
export function safeParseFloat(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * Parses a value as an integer.
 * Returns the parsed integer, or `fallback` if parsing fails.
 */
export function safeParseInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * Safely accesses a nested key on an object.
 * Returns `undefined` instead of throwing if the path does not exist.
 */
export function safeGet<T>(
  obj: Record<string, unknown>,
  key: string
): T | undefined {
  return obj[key] as T | undefined;
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

/**
 * Throws a descriptive error if `value` is null or undefined.
 * Use at the boundaries where a missing value is a programming error.
 */
export function assertDefined<T>(
  value: T | null | undefined,
  label: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(`[guards] Expected "${label}" to be defined, got ${value}`);
  }
}

/**
 * Narrows `value` to type `T` or returns `defaultValue`.
 * Useful for fallback-safe access without a full type guard.
 */
export function coerce<T>(value: unknown, guard: (v: unknown) => v is T, defaultValue: T): T {
  return guard(value) ? value : defaultValue;
}
