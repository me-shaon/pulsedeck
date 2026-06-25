import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { fetch as undiciFetch } from 'undici';
import type { Db } from '../db/index.js';
import { webhookDeliveries, webhooks } from '../db/schema/webhooks.js';
import { FORMATTERS } from './formatters.js';
import { createWebhookDispatcher, guardedFetch } from './safe-fetch.js';
import { signBody } from './signing.js';
import { WebhookUrlError } from './ssrf.js';
import type { ClaimedDelivery } from './types.js';

/**
 * Webhook delivery runner (PRD "Webhooks — delivery"). Sibling to the retention
 * runner: a periodic, `.unref()`'d poller with an observable status snapshot,
 * started in index.ts after the server is listening and stopped on close.
 *
 * Each tick CLAIMS a batch of due deliveries with `FOR UPDATE SKIP LOCKED` (so N
 * replicas deliver in parallel with no double-send — unlike retention's single
 * advisory lock, here we WANT parallelism), POSTs each, and records the result.
 *
 * Delivery lifecycle (the claim only ever sees `pending` + due rows):
 *   pending --claim--> delivering --2xx-------> success   (terminal)
 *                                 \--retryable-> pending   (next_attempt_at pushed out)
 *                                 \--exhausted-> failed    (terminal, never reclaimed)
 */

/** Backoff schedule between attempts; the last entry repeats. */
const BACKOFF_MS = [10_000, 60_000, 300_000, 1_800_000, 7_200_000]; // 10s,1m,5m,30m,2h

export type WebhookRunnerOutcome = 'delivered' | 'idle' | 'error';

export interface WebhookRunnerStatus {
  scheduled: boolean;
  pollIntervalMs: number;
  lastRunAt: string | null;
  lastOutcome: WebhookRunnerOutcome | null;
  lastError: string | null;
  attempts: number;
  delivered: number;
  failed: number;
}

export interface WebhookRunnerLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

const noopLogger: WebhookRunnerLogger = { info: () => {}, warn: () => {}, error: () => {} };

export interface WebhookRunnerOptions {
  db: Db;
  pollIntervalMs: number;
  batchSize: number;
  deliveryTimeoutMs: number;
  allowPrivateIps: boolean;
  initialDelayMs?: number;
  now?: () => Date;
  logger?: WebhookRunnerLogger;
  /** Injectable fetch — tests pass a fake; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable jitter in [0,1) — tests pin it; defaults to crypto-free Math.random. */
  jitter?: () => number;
}

export interface WebhookRunner {
  start(): void;
  stop(): void;
  /** Run a single poll now. Returns once the claimed batch has been attempted. */
  runOnce(): Promise<WebhookRunnerOutcome>;
  getStatus(): WebhookRunnerStatus;
}

export function createWebhookRunner(opts: WebhookRunnerOptions): WebhookRunner {
  const {
    db,
    pollIntervalMs,
    batchSize,
    deliveryTimeoutMs,
    allowPrivateIps,
    now = () => new Date(),
    logger = noopLogger,
    // Default to undici's fetch so it's compatible with the SSRF dispatcher below
    // (a separately-built Agent isn't accepted by Node's global fetch). Tests
    // inject a fake; the dispatcher/redirect guards no-op around it.
    fetchImpl = undiciFetch as unknown as typeof fetch,
    jitter = Math.random,
  } = opts;
  const initialDelayMs = opts.initialDelayMs ?? Math.min(pollIntervalMs, 5000);

  // Connect-time IP-pinning dispatcher (undefined when private IPs are allowed).
  // Built once and reused across deliveries.
  const dispatcher = createWebhookDispatcher(allowPrivateIps);

  let timer: NodeJS.Timeout | null = null;
  let initialTimer: NodeJS.Timeout | null = null;
  let running = false;

  const status: WebhookRunnerStatus = {
    scheduled: false,
    pollIntervalMs,
    lastRunAt: null,
    lastOutcome: null,
    lastError: null,
    attempts: 0,
    delivered: 0,
    failed: 0,
  };

  /** Backoff for the Nth attempt (1-based), with ±20% jitter. */
  function backoffMs(attemptNo: number): number {
    const base = BACKOFF_MS[Math.min(attemptNo - 1, BACKOFF_MS.length - 1)];
    return Math.round(base * (0.8 + jitter() * 0.4));
  }

  /** Atomically claim up to `batchSize` due deliveries, marking them delivering. */
  async function claim(): Promise<ClaimedDelivery[]> {
    return db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: webhookDeliveries.id,
          webhookId: webhookDeliveries.webhookId,
          attempts: webhookDeliveries.attempts,
          maxAttempts: webhookDeliveries.maxAttempts,
          payload: webhookDeliveries.payload,
          url: webhooks.url,
          secret: webhooks.secret,
          format: webhooks.format,
        })
        .from(webhookDeliveries)
        .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
        .where(
          and(eq(webhookDeliveries.status, 'pending'), lte(webhookDeliveries.nextAttemptAt, now())),
        )
        .orderBy(asc(webhookDeliveries.nextAttemptAt))
        .limit(batchSize)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return [];
      await tx
        .update(webhookDeliveries)
        .set({ status: 'delivering' })
        .where(
          inArray(
            webhookDeliveries.id,
            rows.map((r) => r.id),
          ),
        );
      return rows;
    });
  }

  /** Attempt one delivery and persist the outcome. Never throws. */
  async function deliver(row: ClaimedDelivery): Promise<void> {
    const attemptNo = row.attempts + 1;
    try {
      const raw = JSON.stringify(row.payload);
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'user-agent': 'PulseDeck-Webhook/1',
        'x-pulsedeck-event': 'report.created',
        'x-pulsedeck-delivery': row.id,
        'x-pulsedeck-timestamp': now().toISOString(),
      };
      // Only the generic envelope is signed; vendor targets authenticate via
      // the secret URL and would reject an unexpected header.
      if (FORMATTERS[row.format].signs) {
        headers['x-pulsedeck-signature'] = signBody(row.secret, raw);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), deliveryTimeoutMs);
      let code: number;
      try {
        // guardedFetch validates the URL + every redirect hop and pins the
        // connection to a validated IP via `dispatcher` (SSRF defense). The
        // single timeout/abort spans the whole redirect chain.
        const res = await guardedFetch(
          row.url,
          { method: 'POST', headers, body: raw, signal: controller.signal },
          { fetchImpl, dispatcher, allowPrivateIps },
        );
        code = res.status;
      } finally {
        clearTimeout(timeout);
      }

      if (code >= 200 && code < 300) {
        await db
          .update(webhookDeliveries)
          .set({ status: 'success', attempts: attemptNo, lastStatusCode: code, deliveredAt: now() })
          .where(eq(webhookDeliveries.id, row.id));
        status.delivered += 1;
      } else {
        await recordFailure(row, attemptNo, code, `HTTP ${code}`);
      }
    } catch (err) {
      const message = err instanceof WebhookUrlError ? err.message : errMessage(err);
      // A blocked URL is permanent — fail terminally rather than retrying.
      const terminal = err instanceof WebhookUrlError;
      await recordFailure(row, attemptNo, null, message, terminal);
    }
  }

  async function recordFailure(
    row: ClaimedDelivery,
    attemptNo: number,
    code: number | null,
    message: string,
    forceTerminal = false,
  ): Promise<void> {
    const exhausted = forceTerminal || attemptNo >= row.maxAttempts;
    if (exhausted) {
      await db
        .update(webhookDeliveries)
        .set({ status: 'failed', attempts: attemptNo, lastStatusCode: code, lastError: message })
        .where(eq(webhookDeliveries.id, row.id));
      status.failed += 1;
    } else {
      const next = new Date(now().getTime() + backoffMs(attemptNo));
      await db
        .update(webhookDeliveries)
        .set({
          status: 'pending',
          attempts: attemptNo,
          lastStatusCode: code,
          lastError: message,
          nextAttemptAt: next,
        })
        .where(eq(webhookDeliveries.id, row.id));
    }
  }

  async function runOnce(): Promise<WebhookRunnerOutcome> {
    if (running) return 'idle';
    running = true;
    status.attempts += 1;
    let outcome: WebhookRunnerOutcome = 'idle';
    try {
      const batch = await claim();
      if (batch.length > 0) {
        await Promise.all(batch.map((row) => deliver(row)));
        outcome = 'delivered';
      }
      status.lastError = null;
    } catch (err) {
      outcome = 'error';
      status.lastError = errMessage(err);
      logger.error({ err }, 'webhook: delivery poll failed');
    } finally {
      running = false;
      status.lastRunAt = new Date().toISOString();
      status.lastOutcome = outcome;
    }
    return outcome;
  }

  function start(): void {
    if (timer || initialTimer) return;
    status.scheduled = true;
    logger.info({ pollIntervalMs }, 'webhook: delivery runner armed');
    initialTimer = setTimeout(() => {
      initialTimer = null;
      void runOnce();
      timer = setInterval(() => void runOnce(), pollIntervalMs);
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

  return { start, stop, runOnce, getStatus: () => ({ ...status }) };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
