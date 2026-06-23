import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { categories, id, streams, webhooks, workspaces } from '../db/index.js';
import type { Webhook } from '../db/schema/webhooks.js';
import { webhookDeliveries } from '../db/schema/webhooks.js';
import type { ReportIngestedEvent } from '../events/ingestion.js';
import { formatForWebhook } from './formatters.js';
import type { WebhookEvent } from './types.js';

/**
 * Ingestion → webhook fan-out (the cheap, in-process half of delivery).
 *
 * Attached to the in-process ingestion bus. For each committed report it loads
 * the workspace's enabled webhooks, keeps those whose severity/category filters
 * match, formats a frozen body per target, and INSERTs a `webhook_deliveries`
 * row per match. It performs NO HTTP — the durable row is the hand-off to the
 * runner — so ingestion latency stays flat.
 *
 * Loading webhooks per report would add a query to the hot path, so the enabled
 * set is cached per workspace with a short TTL and invalidated on CRUD. Staleness
 * is bounded by the TTL (a brand-new webhook may miss events for a few seconds);
 * CRUD invalidation makes the common case immediate.
 */

export interface EnqueuerOptions {
  db: Db;
  maxAttempts: number;
  appBaseUrl?: string;
  /** Per-workspace cache TTL for the enabled-webhook set (ms). */
  cacheTtlMs?: number;
  now?: () => number;
  logger?: { warn(obj: object, msg?: string): void };
}

export interface Enqueuer {
  /** Bus handler: match + enqueue deliveries for one committed report. */
  onReportIngested(event: ReportIngestedEvent): void;
  /** Drop a workspace's cached webhook set (call on any webhook CRUD). */
  invalidate(workspaceId: string): void;
}

/** True when a webhook's filters select this report. Empty set = "all". */
export function matches(webhook: Webhook, severity: string | null, categoryId: string): boolean {
  if (webhook.severities.length > 0) {
    if (severity == null || !webhook.severities.includes(severity as Webhook['severities'][number]))
      return false;
  }
  if (webhook.categoryIds.length > 0 && !webhook.categoryIds.includes(categoryId)) return false;
  return true;
}

export function createEnqueuer(opts: EnqueuerOptions): Enqueuer {
  const { db, maxAttempts, appBaseUrl } = opts;
  const cacheTtlMs = opts.cacheTtlMs ?? 5000;
  const now = opts.now ?? (() => Date.now());
  const warn = opts.logger?.warn.bind(opts.logger) ?? (() => {});

  const cache = new Map<string, { expires: number; webhooks: Webhook[] }>();

  async function enabledWebhooks(workspaceId: string): Promise<Webhook[]> {
    const hit = cache.get(workspaceId);
    if (hit && hit.expires > now()) return hit.webhooks;
    const rows = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.enabled, true)));
    cache.set(workspaceId, { expires: now() + cacheTtlMs, webhooks: rows });
    return rows;
  }

  async function enrich(event: ReportIngestedEvent): Promise<WebhookEvent | null> {
    const [[ws], [cat], [str]] = await Promise.all([
      db
        .select({ slug: workspaces.slug })
        .from(workspaces)
        .where(eq(workspaces.id, event.workspaceId))
        .limit(1),
      db
        .select({ name: categories.name })
        .from(categories)
        .where(eq(categories.id, event.categoryId))
        .limit(1),
      db
        .select({ name: streams.name, slug: streams.slug })
        .from(streams)
        .where(eq(streams.id, event.streamId))
        .limit(1),
    ]);
    if (!ws || !cat || !str) return null; // structure changed under us — skip
    return {
      deliveryId: '', // filled per delivery below
      workspace: { id: event.workspaceId, slug: ws.slug },
      category: { id: event.categoryId, name: cat.name },
      stream: { id: event.streamId, slug: str.slug, name: str.name },
      report: event.report,
    };
  }

  async function handle(event: ReportIngestedEvent): Promise<void> {
    const candidates = await enabledWebhooks(event.workspaceId);
    if (candidates.length === 0) return;
    const matched = candidates.filter((w) =>
      matches(w, event.report.severity ?? null, event.categoryId),
    );
    if (matched.length === 0) return;

    const base = await enrich(event);
    if (!base) return;

    const rows = matched.map((webhook) => {
      const deliveryId = id('whd');
      const { body } = formatForWebhook(webhook.format, { ...base, deliveryId }, { appBaseUrl });
      return {
        id: deliveryId,
        webhookId: webhook.id,
        reportId: event.report.id,
        maxAttempts,
        payload: body,
      };
    });
    await db.insert(webhookDeliveries).values(rows);
  }

  return {
    onReportIngested(event: ReportIngestedEvent): void {
      // Fire-and-forget: the bus invokes listeners synchronously and the report
      // is already committed, so a delivery-enqueue failure must never bubble.
      void handle(event).catch((err) => warn({ err }, 'webhook enqueue failed'));
    },
    invalidate(workspaceId: string): void {
      cache.delete(workspaceId);
    },
  };
}
