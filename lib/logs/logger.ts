/**
 * lib/logs/logger.ts
 *
 * Structured logger for the Meta Ads Optimizer.
 *
 * Design goals:
 * - Always writes to the console with structured JSON (easy to tail in Vercel).
 * - Optionally persists important events to the SystemLog table via Prisma.
 * - Pure helper functions for building log entries, so the actual I/O is
 *   confined to one place and easy to mock in tests.
 * - Never throws — a logging failure must not crash a business-critical path.
 */

import { writeSystemLog } from '../db/queries';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  context: string;
  message: string;
  meta?: Record<string, unknown>;
  timestamp: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Builds a structured log entry object without performing any I/O.
 * Pure function — safe to use in tests.
 */
export function buildLogEntry(
  level: LogLevel,
  context: string,
  message: string,
  meta?: Record<string, unknown>,
): LogEntry {
  return {
    level,
    context,
    message,
    meta,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Serialises a log entry to a single-line JSON string suitable for
 * structured log aggregators (Vercel, Datadog, etc.).
 */
export function serializeLogEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/** Write a log entry to the appropriate console method. */
function writeToConsole(entry: LogEntry): void {
  const line = serializeLogEntry(entry);
  switch (entry.level) {
    case 'debug':
      console.debug(line);
      break;
    case 'info':
      console.info(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'error':
      console.error(line);
      break;
  }
}

/**
 * Persist a log entry to the DB SystemLog table.
 * Only called for levels >= 'info' to avoid filling the DB with debug noise.
 * Failures are silently swallowed so they never interrupt the caller.
 */
async function persistLog(entry: LogEntry): Promise<void> {
  if (entry.level === 'debug') return;
  try {
    await writeSystemLog({
      level: entry.level as 'info' | 'warn' | 'error',
      context: entry.context,
      message: entry.message,
      meta: entry.meta,
    });
  } catch {
    // Swallow — logging must never crash the application.
  }
}

// ─── Logger factory ───────────────────────────────────────────────────────────

/**
 * Options for creating a logger instance.
 */
export interface LoggerOptions {
  /**
   * When true, log entries at level >= 'info' are persisted to the DB.
   * Default: true unless NODE_ENV === 'test'.
   */
  persistToDb?: boolean;
}

/**
 * A context-scoped logger.
 * Use `createLogger(context)` to get one per module.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): Promise<void>;
  warn(message: string, meta?: Record<string, unknown>): Promise<void>;
  error(message: string, meta?: Record<string, unknown>): Promise<void>;
}

/**
 * Creates a context-scoped logger.
 *
 * @param context     Module or subsystem name (e.g. "sync", "optimizer").
 * @param options     Logger configuration.
 *
 * @example
 * ```ts
 * const logger = createLogger('sync');
 * await logger.info('Sync complete', { campaignId, rowsUpserted });
 * ```
 */
export function createLogger(
  context: string,
  options: LoggerOptions = {},
): Logger {
  const persistToDb = options.persistToDb ?? process.env.NODE_ENV !== 'test';

  function debug(message: string, meta?: Record<string, unknown>): void {
    const entry = buildLogEntry('debug', context, message, meta);
    writeToConsole(entry);
  }

  async function log(
    level: 'info' | 'warn' | 'error',
    message: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const entry = buildLogEntry(level, context, message, meta);
    writeToConsole(entry);
    if (persistToDb) {
      await persistLog(entry);
    }
  }

  return {
    debug,
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
  };
}

// ─── Module-level convenience loggers ────────────────────────────────────────
// Pre-built loggers for the main subsystems.

export const syncLogger = createLogger('sync');
export const optimizerLogger = createLogger('optimizer');
export const budgetLogger = createLogger('budget');
export const cronLogger = createLogger('cron');
