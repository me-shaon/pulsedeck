import type { Db } from '../db/index.js';
import type { Sql } from '../db.js';
import { purgeExpiredReports } from './purge.js';

/**
 * Retention scheduler (PRD "Report Retention" + Tech Stack: "in-process job
 * runner guarded by a Postgres advisory lock").
 *
 * Wraps {@link purgeExpiredReports} with:
 *   - a periodic, `.unref()`'d timer so the sweep never blocks shutdown;
 *   - a Postgres advisory lock so, across N replicas, the purge runs AT MOST
 *     once per tick — `pg_try_advisory_lock` is non-blocking, so a replica that
 *     doesn't win simply skips (no piling up behind a busy peer);
 *   - an observable last-run status surfaced via `/healthz/retention`.
 *
 * When `RETENTION_DAYS <= 0` the runner is inert: it marks itself disabled and
 * NEVER schedules destructive work.
 */

/**
 * Reserved advisory-lock key for the retention sweep. A fixed application-wide
 * bigint, distinct from the admin-provision lock (4242) in `auth/setup.ts`.
 */
export const RETENTION_PURGE_LOCK = 4243;

/** Outcome of the most recent sweep attempt. */
export type RetentionOutcome = 'success' | 'error' | 'skipped';

/** Read-only, JSON-serializable snapshot of the runner's last-run state. */
export interface RetentionStatus {
  /** Whether time-based retention is active (RETENTION_DAYS > 0). */
  enabled: boolean;
  /** Configured retention window in days (0 = keep forever). */
  retentionDays: number;
  /** Sweep cadence in milliseconds. */
  sweepIntervalMs: number;
  /** Whether the periodic timer is currently armed. */
  scheduled: boolean;
  /** ISO-8601 time the last sweep attempt finished, or null if none yet. */
  lastRunAt: string | null;
  /** Duration of the last sweep attempt in ms, or null. */
  lastDurationMs: number | null;
  /** Rows deleted by the last sweep that actually ran (held the lock), or null. */
  lastDeletedCount: number | null;
  /** Outcome of the last attempt, or null before the first run. */
  lastOutcome: RetentionOutcome | null;
  /** Error message from the last failed sweep (sanitized), or null. */
  lastError: string | null;
  /** Total sweep attempts since boot (including skipped/errored). */
  attempts: number;
  /** Total attempts that acquired the lock and ran the purge. */
  runs: number;
}

/** Minimal structured logger; satisfied by `app.log` (pino). */
export interface RetentionLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

const noopLogger: RetentionLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface RetentionRunnerOptions {
  db: Db;
  sql: Sql;
  retentionDays: number;
  sweepIntervalMs: number;
  /** Delay before the FIRST sweep after `start()`. Defaults to min(interval, 30s). */
  initialDelayMs?: number;
  /** Injected clock — tests pass a fixed/controllable `now`. */
  now?: () => Date;
  logger?: RetentionLogger;
  /** Injectable purge fn (defaults to {@link purgeExpiredReports}) — for unit tests. */
  purge?: (db: Db, retentionDays: number, now: Date) => Promise<number>;
}

export interface RetentionRunner {
  /** Arm the periodic sweep (no-op when disabled). Idempotent. */
  start(): void;
  /** Disarm the timer. Idempotent; safe to call on shutdown. */
  stop(): void;
  /** Run a single sweep now (lock-guarded). Exposed for the first run + tests. */
  runOnce(): Promise<RetentionOutcome>;
  /** Current observable status snapshot. */
  getStatus(): RetentionStatus;
}

/**
 * Build a retention runner. Does NOT start the timer — call `start()` (index.ts
 * does, after the server is listening). Constructing one is side-effect-free, so
 * tests/`buildServer` can create it without spawning timers.
 */
export function createRetentionRunner(opts: RetentionRunnerOptions): RetentionRunner {
  const {
    db,
    sql,
    retentionDays,
    sweepIntervalMs,
    now = () => new Date(),
    logger = noopLogger,
    purge = purgeExpiredReports,
  } = opts;

  const enabled = retentionDays > 0;
  const initialDelayMs = opts.initialDelayMs ?? Math.min(sweepIntervalMs, 30_000);

  let timer: NodeJS.Timeout | null = null;
  let initialTimer: NodeJS.Timeout | null = null;
  let running = false;

  const status: RetentionStatus = {
    enabled,
    retentionDays,
    sweepIntervalMs,
    scheduled: false,
    lastRunAt: null,
    lastDurationMs: null,
    lastDeletedCount: null,
    lastOutcome: null,
    lastError: null,
    attempts: 0,
    runs: 0,
  };

  /**
   * One sweep attempt. Holds a session-level advisory lock on a RESERVED
   * connection (separate from the pooled `db` that runs the DELETE — the lock
   * only gates "does this replica sweep this tick"). `pg_try_advisory_lock` is
   * non-blocking: a replica that doesn't get the lock returns immediately as
   * 'skipped'. Never throws — failures are recorded in the status and swallowed
   * so the periodic timer keeps ticking.
   */
  async function runOnce(): Promise<RetentionOutcome> {
    if (!enabled) {
      // Defensive: callers shouldn't invoke a disabled runner, but make it a
      // guaranteed no-op rather than risk an unguarded DELETE path.
      return 'skipped';
    }
    if (running) {
      // A previous sweep is still in flight (e.g. a slow DELETE). Don't overlap.
      return 'skipped';
    }
    running = true;
    status.attempts += 1;
    const start = Date.now();
    let outcome: RetentionOutcome = 'skipped';
    let deleted: number | null = null;
    let errorMessage: string | null = null;

    const conn = await sql.reserve();
    try {
      const [lock] = await conn<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(${RETENTION_PURGE_LOCK}) AS locked`;
      if (!lock?.locked) {
        // Another replica holds the lock and is sweeping this tick — skip.
        outcome = 'skipped';
        logger.info({ retentionDays }, 'retention: sweep skipped (lock held elsewhere)');
        return outcome;
      }
      try {
        logger.info({ retentionDays }, 'retention: sweep started');
        deleted = await purge(db, retentionDays, now());
        outcome = 'success';
        status.runs += 1;
        logger.info(
          { retentionDays, deleted, durationMs: Date.now() - start },
          'retention: sweep completed',
        );
      } finally {
        // Release the advisory lock regardless of purge success/failure.
        await conn`SELECT pg_advisory_unlock(${RETENTION_PURGE_LOCK})`.catch(() => {});
      }
    } catch (err) {
      outcome = 'error';
      errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ err }, 'retention: sweep failed');
    } finally {
      conn.release();
      running = false;
      status.lastRunAt = new Date().toISOString();
      status.lastDurationMs = Date.now() - start;
      status.lastOutcome = outcome;
      status.lastError = outcome === 'error' ? errorMessage : null;
      // Only update the deleted count for an attempt that actually ran the purge.
      if (outcome === 'success') status.lastDeletedCount = deleted;
    }
    return outcome;
  }

  function start(): void {
    if (!enabled) {
      logger.info(
        { retentionDays },
        'retention: disabled (RETENTION_DAYS=0) — reports kept forever',
      );
      return;
    }
    if (timer || initialTimer) return; // already started
    status.scheduled = true;
    logger.info({ retentionDays, sweepIntervalMs, initialDelayMs }, 'retention: scheduler armed');
    // First sweep shortly after boot, then on the fixed interval. Both timers are
    // unref()'d so a pending sweep never keeps the process alive at shutdown.
    initialTimer = setTimeout(() => {
      initialTimer = null;
      void runOnce();
      timer = setInterval(() => void runOnce(), sweepIntervalMs);
      timer.unref();
    }, initialDelayMs);
    initialTimer.unref();
  }

  function stop(): void {
    if (initialTimer) {
      clearTimeout(initialTimer);
      initialTimer = null;
    }
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    status.scheduled = false;
  }

  function getStatus(): RetentionStatus {
    return { ...status };
  }

  return { start, stop, runOnce, getStatus };
}
