/**
 * lib/meta/client.ts
 *
 * Base HTTP client for the Meta Graph API.
 *
 * Provides a typed `metaGet` and `metaPost` helper that:
 *  - Automatically appends the access token to every request
 *  - Respects the configured API version and base URL
 *  - Retries on transient errors (rate-limit 80000 / 17, HTTP 5xx)
 *  - Throws a descriptive `MetaApiError` on non-retryable failures
 *  - Times out after META_REQUEST_TIMEOUT_MS
 *
 * Do not call `fetch` with graph.facebook.com URLs anywhere else in the app;
 * use these helpers so all requests get the same retry / auth treatment.
 */

import type { MetaApiErrorResponse, MetaListResponse } from '../../types/meta';
import {
  META_ACCESS_TOKEN,
  META_API_BASE_URL,
  META_MAX_RETRIES,
  META_REQUEST_TIMEOUT_MS,
  META_RETRY_BASE_DELAY_MS,
} from './config';

// ─── Error class ──────────────────────────────────────────────────────────────

export class MetaApiError extends Error {
  readonly code: number;
  readonly subcode: number | undefined;
  readonly fbtrace: string | undefined;
  readonly type: string;

  constructor(
    message: string,
    code: number,
    type: string,
    subcode?: number,
    fbtrace?: string,
  ) {
    super(`[Meta API] ${message} (code=${code}, type=${type})`);
    this.name = 'MetaApiError';
    this.code = code;
    this.type = type;
    this.subcode = subcode;
    this.fbtrace = fbtrace;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true for Meta error codes that indicate a transient failure that
 * is safe to retry (rate limits, temporary server errors).
 */
function isRetryableCode(code: number): boolean {
  // 17  = User request limit reached
  // 80000 = Campaign-level rate limit
  // 80001 = Ad-account request limit
  // 80003 = Application-level request limit
  const retryableCodes = new Set([17, 80000, 80001, 80003]);
  return retryableCodes.has(code);
}

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serialise a params object into a URL query string.
 * Arrays are joined with commas (e.g. fields=a,b,c).
 */
function buildQueryString(params: Record<string, string | string[] | number | boolean>): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value.join(','))}`);
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

// ─── Core request function ────────────────────────────────────────────────────

/**
 * Low-level request function with retry logic.
 * Exported for use by entity helpers; prefer `metaGet` / `metaPost`.
 */
async function metaRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string | string[] | number | boolean> = {},
  body?: Record<string, string | number | boolean>,
): Promise<T> {
  // Always inject the access token.
  const allParams: Record<string, string | string[] | number | boolean> = {
    access_token: META_ACCESS_TOKEN,
    ...params,
  };

  const url = `${META_API_BASE_URL}/${path.replace(/^\//, '')}`;

  let attempt = 0;

  while (attempt <= META_MAX_RETRIES) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), META_REQUEST_TIMEOUT_MS);

    try {
      let requestUrl: string;
      let fetchOptions: RequestInit;

      if (method === 'GET') {
        requestUrl = `${url}${buildQueryString(allParams)}`;
        fetchOptions = { method: 'GET', signal: controller.signal };
      } else {
        // POST: params in query string (for access_token), body as form-encoded
        requestUrl = `${url}${buildQueryString({ access_token: META_ACCESS_TOKEN })}`;
        const formParams: Record<string, string | string[] | number | boolean> = {
          ...params,
          ...(body ?? {}),
        };
        const formBody = buildQueryString(formParams).replace(/^\?/, '');
        fetchOptions = {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formBody,
        };
      }

      const response = await fetch(requestUrl, fetchOptions);
      clearTimeout(timeoutId);

      const json = (await response.json()) as T | MetaApiErrorResponse;

      // The Graph API sometimes returns a 200 with an error object inside.
      if (
        json !== null &&
        typeof json === 'object' &&
        'error' in json &&
        json.error !== null &&
        typeof json.error === 'object'
      ) {
        const errObj = (json as MetaApiErrorResponse).error;

        if (isRetryableCode(errObj.code) && attempt < META_MAX_RETRIES) {
          // Exponential back-off
          await sleep(META_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          attempt++;
          continue;
        }

        throw new MetaApiError(
          errObj.message,
          errObj.code,
          errObj.type,
          errObj.error_subcode,
          errObj.fbtrace_id,
        );
      }

      if (!response.ok) {
        if (response.status >= 500 && attempt < META_MAX_RETRIES) {
          await sleep(META_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          attempt++;
          continue;
        }
        throw new MetaApiError(
          `HTTP ${response.status} ${response.statusText}`,
          response.status,
          'HTTPError',
        );
      }

      return json as T;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof MetaApiError) throw err;

      // AbortError = timeout
      if (err instanceof Error && err.name === 'AbortError') {
        if (attempt < META_MAX_RETRIES) {
          await sleep(META_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          attempt++;
          continue;
        }
        throw new MetaApiError(
          `Request timed out after ${META_REQUEST_TIMEOUT_MS}ms`,
          408,
          'Timeout',
        );
      }

      // Network / fetch errors — retry
      if (attempt < META_MAX_RETRIES) {
        await sleep(META_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
        attempt++;
        continue;
      }

      throw new MetaApiError(
        err instanceof Error ? err.message : 'Unknown fetch error',
        0,
        'NetworkError',
      );
    }
  }

  // Should be unreachable, but TypeScript requires it.
  throw new MetaApiError('Max retries exceeded', 0, 'MaxRetriesExceeded');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Perform a GET request against the Meta Graph API.
 *
 * @param path    Path relative to the versioned base URL (e.g. "me/campaigns")
 * @param params  Query-string parameters (access_token is added automatically)
 */
export async function metaGet<T>(
  path: string,
  params: Record<string, string | string[] | number | boolean> = {},
): Promise<T> {
  return metaRequest<T>('GET', path, params);
}

/**
 * Perform a POST request against the Meta Graph API.
 *
 * @param path    Path relative to the versioned base URL
 * @param params  Additional query params
 * @param body    Form-body fields
 */
export async function metaPost<T>(
  path: string,
  params: Record<string, string | string[] | number | boolean> = {},
  body: Record<string, string | number | boolean> = {},
): Promise<T> {
  return metaRequest<T>('POST', path, params, body);
}

/**
 * Paginate through a Meta edge that returns a `MetaListResponse<T>`.
 * Follows `paging.next` cursors until all data is collected or `maxPages` is
 * reached (default: 10 — a safeguard against infinite loops).
 */
export async function metaGetAll<T>(
  path: string,
  params: Record<string, string | string[] | number | boolean> = {},
  maxPages = 10,
): Promise<T[]> {
  const results: T[] = [];
  let nextPath: string | null = path;
  let nextParams = { ...params };
  let pages = 0;

  while (nextPath && pages < maxPages) {
    const page = await metaGet<MetaListResponse<T>>(nextPath, nextParams);
    results.push(...page.data);

    const nextUrl = page.paging?.next;
    if (!nextUrl) break;

    // The `next` URL is fully formed; extract cursor and continue.
    try {
      const parsedUrl = new URL(nextUrl);
      const after = parsedUrl.searchParams.get('after');
      if (!after) break;
      nextParams = { ...params, after };
    } catch {
      break;
    }

    pages++;
  }

  return results;
}
