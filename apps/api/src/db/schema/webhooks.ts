import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';
import { serverTimestamp, utcTimestamp } from './columns.js';
import { reportSeverity } from './enums.js';
import { reports } from './reports.js';
import { workspaces } from './workspaces.js';

/**
 * Outbound webhooks (PRD "Notifications" / "Webhooks", v1.1).
 *
 * A webhook is a per-workspace subscription that delivers matching reports to an
 * external URL. Matching is two filters, each an empty-set-means-all:
 *
 *   fire when (severities = {} OR report.severity ∈ severities)
 *          AND (categoryIds = {} OR report.categoryId ∈ categoryIds)
 *
 * so an operator can route "all critical → #alerts" or "Engineering → #eng"
 * to different channels by registering several webhooks.
 *
 * Delivery is decoupled from ingestion via {@link webhookDeliveries}: the
 * ingestion subscriber only MATCHES + INSERTs a delivery row (the durable
 * hand-off); a background runner claims due rows and performs the HTTP POST.
 * This keeps ingestion latency flat and makes delivery safe across replicas
 * (the runner claims rows with `FOR UPDATE SKIP LOCKED`).
 */

/** Output shape sent to the target — picks the per-webhook payload formatter. */
export const webhookFormat = pgEnum('webhook_format', [
  'generic',
  'slack',
  'discord',
  'mattermost',
]);

/** Lifecycle of a single delivery attempt-set (one row per webhook × report). */
export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', [
  'pending',
  'delivering',
  'success',
  'failed',
]);

/** `'generic' | 'slack' | 'discord' | 'mattermost'`. */
export type WebhookFormat = (typeof webhookFormat.enumValues)[number];
/** `'pending' | 'delivering' | 'success' | 'failed'`. */
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatus.enumValues)[number];

export const webhooks = pgTable(
  'webhooks',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    format: webhookFormat('format').notNull().default('generic'),
    // HMAC signing key (generic format only). Server-generated, returned to the
    // operator once on create/rotate and never again. Vendor formats ignore it.
    secret: text('secret').notNull(),
    // Empty array = "all severities". Mirrors the report_severity enum so the
    // filter can never reference a severity the wire contract doesn't define.
    severities: reportSeverity('severities')
      .array()
      .notNull()
      .default(sql`'{}'::report_severity[]`),
    // Empty array = "all categories in the workspace". Plain text ids (no FK
    // array in Postgres); a deleted category simply stops matching.
    categoryIds: text('category_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: serverTimestamp('created_at'),
    updatedAt: serverTimestamp('updated_at'),
  },
  (t) => [index('webhooks_workspace_idx').on(t.workspaceId)],
);

export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    webhookId: text('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    // The report that triggered this delivery. SET NULL (not cascade) so
    // per-account retention can purge the report while the delivery + its log
    // survive — the payload is snapshotted below, so nothing is lost.
    reportId: text('report_id').references(() => reports.id, { onDelete: 'set null' }),
    status: webhookDeliveryStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    // When the runner should next try this row. Set to now() on enqueue; pushed
    // out by the backoff schedule after each failed attempt.
    nextAttemptAt: utcTimestamp('next_attempt_at').notNull().defaultNow(),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    // The exact, already-formatted body to POST. Frozen at enqueue time so the
    // delivery is self-contained (survives report purge, format/version locked,
    // redeliver is byte-identical).
    payload: jsonb('payload').notNull(),
    createdAt: serverTimestamp('created_at'),
    deliveredAt: utcTimestamp('delivered_at'),
  },
  (t) => [
    // Runner claim query: due rows in a retryable state, oldest first.
    index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    // Delivery-log UI: newest attempts for one webhook.
    index('webhook_deliveries_webhook_idx').on(t.webhookId, t.createdAt.desc()),
  ],
);

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
