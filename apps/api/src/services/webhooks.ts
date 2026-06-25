import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { categories, id, workspaces } from '../db/index.js';
import type { Webhook, WebhookDelivery, WebhookFormat } from '../db/schema/webhooks.js';
import { webhookDeliveries, webhooks } from '../db/schema/webhooks.js';
import type { Severity } from '@pulsedeck/schema';
import { formatForWebhook } from '../webhooks/formatters.js';
import { generateWebhookSecret } from '../webhooks/signing.js';

/**
 * Webhook CRUD + delivery-log queries (the management half; the delivery engine
 * lives in `src/webhooks`). All functions are workspace-scoped — the caller's
 * route has already gated `webhooks:manage` and resolved `workspaceId`.
 *
 * The `secret` is write-once: returned by {@link createWebhook}/{@link rotateSecret}
 * and never by the read paths, which return {@link PublicWebhook}.
 */

/** Webhook as exposed to the API — the signing secret is omitted. */
export type PublicWebhook = Omit<Webhook, 'secret'>;

function toPublic(row: Webhook): PublicWebhook {
  const rest = { ...row } as Partial<Webhook>;
  delete rest.secret;
  return rest as PublicWebhook;
}

export interface WebhookInput {
  name: string;
  url: string;
  format: WebhookFormat;
  severities: Severity[];
  categoryIds: string[];
  enabled: boolean;
}

/** Keep only category ids that actually belong to this workspace. */
async function pruneCategoryIds(
  db: Db,
  workspaceId: string,
  categoryIds: string[],
): Promise<string[]> {
  if (categoryIds.length === 0) return [];
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.workspaceId, workspaceId), inArray(categories.id, categoryIds)));
  return rows.map((r) => r.id);
}

export async function listWebhooks(db: Db, workspaceId: string): Promise<PublicWebhook[]> {
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.workspaceId, workspaceId))
    .orderBy(desc(webhooks.createdAt));
  return rows.map(toPublic);
}

export async function getWebhook(
  db: Db,
  workspaceId: string,
  webhookId: string,
): Promise<PublicWebhook | null> {
  const row = await findRow(db, workspaceId, webhookId);
  return row ? toPublic(row) : null;
}

async function findRow(
  db: Db,
  workspaceId: string,
  webhookId: string,
): Promise<Webhook | undefined> {
  const [row] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.workspaceId, workspaceId)))
    .limit(1);
  return row;
}

/** Create a webhook. Returns the full row INCLUDING the one-time `secret`. */
export async function createWebhook(
  db: Db,
  workspaceId: string,
  input: WebhookInput,
): Promise<Webhook> {
  const [row] = await db
    .insert(webhooks)
    .values({
      id: id('wh'),
      workspaceId,
      name: input.name,
      url: input.url,
      format: input.format,
      secret: generateWebhookSecret(),
      severities: input.severities,
      categoryIds: await pruneCategoryIds(db, workspaceId, input.categoryIds),
      enabled: input.enabled,
    })
    .returning();
  return row;
}

/** Patch an existing webhook. Returns the public row, or null if not found. */
export async function updateWebhook(
  db: Db,
  workspaceId: string,
  webhookId: string,
  patch: Partial<WebhookInput>,
): Promise<PublicWebhook | null> {
  const existing = await findRow(db, workspaceId, webhookId);
  if (!existing) return null;
  const next: Partial<typeof webhooks.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.url !== undefined) next.url = patch.url;
  if (patch.format !== undefined) next.format = patch.format;
  if (patch.severities !== undefined) next.severities = patch.severities;
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.categoryIds !== undefined) {
    next.categoryIds = await pruneCategoryIds(db, workspaceId, patch.categoryIds);
  }
  const [row] = await db
    .update(webhooks)
    .set(next)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.workspaceId, workspaceId)))
    .returning();
  return row ? toPublic(row) : null;
}

/** Rotate the signing secret. Returns the new secret, or null if not found. */
export async function rotateSecret(
  db: Db,
  workspaceId: string,
  webhookId: string,
): Promise<string | null> {
  const secret = generateWebhookSecret();
  const [row] = await db
    .update(webhooks)
    .set({ secret, updatedAt: new Date() })
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.workspaceId, workspaceId)))
    .returning({ id: webhooks.id });
  return row ? secret : null;
}

export async function deleteWebhook(
  db: Db,
  workspaceId: string,
  webhookId: string,
): Promise<boolean> {
  const rows = await db
    .delete(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.workspaceId, workspaceId)))
    .returning({ id: webhooks.id });
  return rows.length > 0;
}

/**
 * Enqueue a synthetic test delivery for a webhook so the operator can confirm
 * the endpoint receives + renders a message. Uses the webhook's real format and
 * a placeholder report; `reportId` is null (no real report backs it).
 */
export async function enqueueTestDelivery(
  db: Db,
  workspaceId: string,
  webhookId: string,
  opts: { appBaseUrl?: string; maxAttempts: number },
): Promise<string | null> {
  const webhook = await findRow(db, workspaceId, webhookId);
  if (!webhook) return null;
  const [ws] = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const deliveryId = id('whd');
  const now = new Date();
  const { body } = formatForWebhook(
    webhook.format,
    {
      deliveryId,
      workspace: { id: workspaceId, slug: ws?.slug ?? workspaceId },
      category: { id: 'test', name: 'Test' },
      stream: { id: 'test', slug: 'test', name: 'Test Stream' },
      report: {
        id: 'test',
        streamId: 'test',
        workspaceId,
        sourceId: 'test',
        idempotencyKey: deliveryId,
        title: 'PulseDeck test event',
        summary: 'This is a test delivery triggered from the webhook settings.',
        severity: 'info',
        occurredAt: now,
        receivedAt: now,
        createdAt: now,
        archivedAt: null,
        tags: ['test'],
        blocks: [],
        searchVector: '',
      },
    },
    { appBaseUrl: opts.appBaseUrl },
  );
  await db.insert(webhookDeliveries).values({
    id: deliveryId,
    webhookId,
    reportId: null,
    maxAttempts: opts.maxAttempts,
    payload: body,
  });
  return deliveryId;
}

export interface DeliveryPage {
  items: WebhookDelivery[];
  nextCursor: string | null;
}

/** Encode/decode a keyset cursor over `(created_at, id)`. */
function encodeCursor(row: WebhookDelivery): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}
function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, rowId] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(iso);
    if (!rowId || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: rowId };
  } catch {
    return null;
  }
}

/** Paginated delivery log for one webhook, newest-first. */
export async function listDeliveries(
  db: Db,
  workspaceId: string,
  webhookId: string,
  opts: { limit: number; cursor?: string },
): Promise<DeliveryPage | null> {
  const webhook = await findRow(db, workspaceId, webhookId);
  if (!webhook) return null;

  const conds = [eq(webhookDeliveries.webhookId, webhookId)];
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    if (c) {
      // (created_at, id) strictly before the cursor — keyset, no offset scan.
      conds.push(
        or(
          lt(webhookDeliveries.createdAt, c.createdAt),
          and(eq(webhookDeliveries.createdAt, c.createdAt), lt(webhookDeliveries.id, c.id)),
        )!,
      );
    }
  }

  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(and(...conds))
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(opts.limit + 1);

  const items = rows.slice(0, opts.limit);
  const nextCursor = rows.length > opts.limit ? encodeCursor(items[items.length - 1]) : null;
  return { items, nextCursor };
}

/**
 * Re-enqueue a terminal (success/failed) delivery: reset it to `pending`, due
 * now, attempts cleared. No-op (returns false) for an unknown delivery or one
 * still in flight.
 */
export async function redeliver(db: Db, workspaceId: string, deliveryId: string): Promise<boolean> {
  // Confirm the delivery belongs to a webhook in this workspace.
  const [row] = await db
    .select({ id: webhookDeliveries.id, status: webhookDeliveries.status })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
    .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhooks.workspaceId, workspaceId)))
    .limit(1);
  if (!row || (row.status !== 'success' && row.status !== 'failed')) return false;
  await db
    .update(webhookDeliveries)
    .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), lastError: null })
    .where(eq(webhookDeliveries.id, deliveryId));
  return true;
}
