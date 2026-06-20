import {
  SCHEMA_VERSION,
  validateReport,
  type Issue,
  type Report as WireReport,
} from '@pulsedeck/schema';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import {
  categories,
  id,
  reportMetrics,
  reports,
  sourceCategories,
  sourceStreams,
  streams,
  type Category,
  type Report,
  type Source,
  type Stream,
} from '../db/index.js';
import type { IngestionBus } from '../events/ingestion.js';

/**
 * Report ingestion pipeline (PRD "Agent Integration Protocol" + "Source Write
 * Scope"). The route stays thin; all correctness lives here.
 *
 * Pipeline order (deliberate — see the per-step comments):
 *   1. Idempotent replay  — short-circuits BEFORE validation so a replay returns
 *      the ORIGINAL result even if the schema later changed (PRD idempotency).
 *   2. Schema validation  — 422 with structured `issues[]`.
 *   3. Scope enforcement  — 403 outside the source's write scope.
 *   4. Slug resolution    — resolve (or autocreate) category + stream, or 409.
 *   5. Insert + metrics    — one transaction, ON CONFLICT DO NOTHING to win the
 *      idempotency race; extract `metric` blocks into `report_metrics`.
 *   6. Emit ingestion event — after commit, for genuine inserts only.
 *
 * The authenticated `source` (never `payload.source.id`) determines the
 * workspace: a source is workspace-bound, so trusting the body could let a
 * caller target another workspace. The body's `source.id`/`workspace` are
 * ignored entirely.
 */

/** Discriminated result the route maps to a status code. */
export type IngestResult =
  | { status: 'created'; report: Report }
  | { status: 'duplicate'; report: Report }
  | { status: 'validation_failed'; issues: Issue[] }
  | { status: 'out_of_scope' }
  | { status: 'unknown_slug'; which: 'category' | 'stream' };

/** Transaction-internal outcome; `created` carries the resolved category id for
 * the post-commit event. Mapped to the public {@link IngestResult} afterwards. */
type TxnOutcome =
  | { status: 'created'; report: Report; categoryId: string }
  | { status: 'duplicate'; report: Report }
  | { status: 'out_of_scope' }
  | { status: 'unknown_slug'; which: 'category' | 'stream' };

/** The schema version echoed in validation-failure responses. */
export const ingestSchemaVersion = SCHEMA_VERSION;

/** A Drizzle transaction handle (the argument to `db.transaction`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Derive a human-friendly display name from a slug (`daily-infra` → `Daily Infra`). */
function titleFromSlug(slug: string): string {
  const words = slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length > 0 ? words.join(' ') : slug;
}

/**
 * Build the `search_vector` expression for the insert. The column is a plain
 * (non-generated) tsvector — see the `reports` table doc — so we compute it at
 * write time, mirroring the documented expression
 * `to_tsvector('english', title || ' ' || coalesce(summary,'') || ' ' || array_to_string(tags,' '))`.
 * Values are passed as bound parameters (never string-concatenated into SQL).
 */
function searchVector(title: string, summary: string | undefined, tags: string[]) {
  return sql`to_tsvector('english', ${title} || ' ' || ${summary ?? ''} || ' ' || ${tags.join(' ')})`;
}

/** Find an already-stored report for this (source, idempotency_key), if any. */
async function findExisting(
  db: Db,
  sourceId: string,
  idempotencyKey: string,
): Promise<Report | undefined> {
  const [row] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.sourceId, sourceId), eq(reports.idempotencyKey, idempotencyKey)))
    .limit(1);
  return row;
}

/** Resolve a category by slug within the workspace; create it when permitted. */
async function resolveCategory(
  tx: Tx,
  workspaceId: string,
  slug: string,
): Promise<Category | undefined> {
  const [existing] = await tx
    .select()
    .from(categories)
    .where(and(eq(categories.workspaceId, workspaceId), eq(categories.slug, slug)))
    .limit(1);
  return existing;
}

async function createCategory(tx: Tx, workspaceId: string, slug: string): Promise<Category> {
  // ON CONFLICT DO NOTHING + reselect: a concurrent push with the same slug may
  // win the unique (workspace_id, slug) race; we then read whichever row exists.
  await tx
    .insert(categories)
    .values({ id: id('cat'), workspaceId, name: titleFromSlug(slug), slug })
    .onConflictDoNothing({ target: [categories.workspaceId, categories.slug] });
  const row = await resolveCategory(tx, workspaceId, slug);
  return row!;
}

async function resolveStream(
  tx: Tx,
  categoryId: string,
  slug: string,
): Promise<Stream | undefined> {
  const [existing] = await tx
    .select()
    .from(streams)
    .where(and(eq(streams.categoryId, categoryId), eq(streams.slug, slug)))
    .limit(1);
  return existing;
}

async function createStream(tx: Tx, categoryId: string, slug: string): Promise<Stream> {
  await tx
    .insert(streams)
    .values({ id: id('stm'), categoryId, name: titleFromSlug(slug), slug })
    .onConflictDoNothing({ target: [streams.categoryId, streams.slug] });
  const row = await resolveStream(tx, categoryId, slug);
  return row!;
}

/**
 * Resolve the target stream within the source's scope, autocreating as allowed.
 * Returns the destination stream + its category, or a terminal scope/slug error.
 *
 * Scope + autocreate interaction (PRD "Source Write Scope"):
 *   - `workspace`: may write anywhere in its own workspace. A missing category
 *     and/or stream is autocreated when `allowStreamAutocreate` is true, else 409.
 *   - `category`: may write only to granted categories. A non-granted (or
 *     non-existent) category is OUT OF SCOPE (403) — autocreating a brand-new
 *     category would escape the grant. Within a granted category, a missing
 *     stream is autocreated (when allowed) or 409.
 *   - `stream`: may write only to granted streams. A stream that doesn't exist
 *     or isn't granted is OUT OF SCOPE (403); autocreate is never available to a
 *     stream-scoped source (it could only ever escape the grant).
 *
 * Category-autocreate decision: `allow_stream_autocreate` gates BOTH stream and
 * (for workspace scope) category creation. Creating a stream usually requires
 * its parent category to exist, so a single flag governs "may this source mint
 * new destinations"; splitting them would let a stream be created with no home.
 */
async function resolveDestination(
  tx: Tx,
  source: Source,
  categorySlug: string,
  streamSlug: string,
): Promise<
  | { category: Category; stream: Stream }
  | { status: 'out_of_scope' }
  | { status: 'unknown_slug'; which: 'category' | 'stream' }
> {
  const { workspaceId, scope, allowStreamAutocreate } = source;

  if (scope === 'stream') {
    // Only pre-existing, explicitly granted streams are writable.
    const category = await resolveCategory(tx, workspaceId, categorySlug);
    if (!category) return { status: 'out_of_scope' };
    const stream = await resolveStream(tx, category.id, streamSlug);
    if (!stream) return { status: 'out_of_scope' };
    const [grant] = await tx
      .select({ streamId: sourceStreams.streamId })
      .from(sourceStreams)
      .where(and(eq(sourceStreams.sourceId, source.id), eq(sourceStreams.streamId, stream.id)))
      .limit(1);
    if (!grant) return { status: 'out_of_scope' };
    return { category, stream };
  }

  if (scope === 'category') {
    // The category must already exist AND be granted; only the stream may be new.
    const category = await resolveCategory(tx, workspaceId, categorySlug);
    if (!category) return { status: 'out_of_scope' };
    const [grant] = await tx
      .select({ categoryId: sourceCategories.categoryId })
      .from(sourceCategories)
      .where(
        and(eq(sourceCategories.sourceId, source.id), eq(sourceCategories.categoryId, category.id)),
      )
      .limit(1);
    if (!grant) return { status: 'out_of_scope' };

    let stream = await resolveStream(tx, category.id, streamSlug);
    if (!stream) {
      if (!allowStreamAutocreate) return { status: 'unknown_slug', which: 'stream' };
      stream = await createStream(tx, category.id, streamSlug);
    }
    return { category, stream };
  }

  // scope === 'workspace' — free to write anywhere in its own workspace.
  let category = await resolveCategory(tx, workspaceId, categorySlug);
  if (!category) {
    if (!allowStreamAutocreate) return { status: 'unknown_slug', which: 'category' };
    category = await createCategory(tx, workspaceId, categorySlug);
  }
  let stream = await resolveStream(tx, category.id, streamSlug);
  if (!stream) {
    if (!allowStreamAutocreate) return { status: 'unknown_slug', which: 'stream' };
    stream = await createStream(tx, category.id, streamSlug);
  }
  return { category, stream };
}

/** Extract `metric` blocks into denormalized `report_metrics` rows. */
async function insertMetrics(
  tx: Tx,
  report: WireReport,
  reportId: string,
  streamId: string,
  occurredAt: Date,
): Promise<void> {
  const rows: Array<typeof reportMetrics.$inferInsert> = [];
  for (const block of report.blocks) {
    if (block.type === 'metric') {
      rows.push({
        id: id('mtr'),
        reportId,
        streamId,
        key: block.key,
        value: block.value,
        occurredAt,
      });
    }
  }
  if (rows.length > 0) {
    await tx.insert(reportMetrics).values(rows);
  }
}

export interface IngestInput {
  source: Source;
  idempotencyKey: string;
  /** Raw, unvalidated request body. */
  payload: unknown;
}

/**
 * Run the full ingestion pipeline. Pure of HTTP concerns — the route handles the
 * status-code mapping, the missing-key 400, the oversize 422, and the 429.
 */
export async function ingestReport(
  db: Db,
  bus: IngestionBus,
  { source, idempotencyKey, payload }: IngestInput,
): Promise<IngestResult> {
  // 1. Idempotent replay (pre-validation): a key we've already accepted returns
  //    the ORIGINAL stored report, without re-validating or re-inserting.
  const replay = await findExisting(db, source.id, idempotencyKey);
  if (replay) return { status: 'duplicate', report: replay };

  // 2. Validate the envelope + blocks against the canonical schema.
  const validation = validateReport(payload);
  if (!validation.success) return { status: 'validation_failed', issues: validation.issues };
  const report = validation.data;

  const meta = report.report;
  const occurredAt = new Date(meta.occurred_at);
  const tags = meta.tags ?? [];

  // 3-5. Resolve destination + insert atomically. The transaction carries the
  // resolved `categoryId` on a `created` outcome so the post-commit event can
  // include it without a second lookup.
  const outcome = await db.transaction(async (tx): Promise<TxnOutcome> => {
    const dest = await resolveDestination(tx, source, report.category.slug, report.stream.slug);
    if ('status' in dest) return dest; // out_of_scope | unknown_slug

    const reportId = id('rpt');
    const inserted = await tx
      .insert(reports)
      .values({
        id: reportId,
        streamId: dest.stream.id,
        // Denormalized owning workspace, taken from the AUTHENTICATED source
        // (never the request body) — a source is workspace-bound, so this is the
        // authoritative scope. Powers the workspace-wide list's composite index.
        workspaceId: source.workspaceId,
        sourceId: source.id,
        idempotencyKey,
        title: meta.title,
        summary: meta.summary ?? null,
        // Store the agent-sent severity verbatim (or null) — the wire enum and
        // the `report_severity` column share the same values.
        severity: meta.severity ?? null,
        occurredAt,
        // `received_at`/`created_at` default to server now(); ordering/retention
        // use server time, never the agent-supplied `occurred_at`.
        tags,
        blocks: report.blocks,
        searchVector: searchVector(meta.title, meta.summary, tags),
      })
      // Win-or-defer on the unique (source_id, idempotency_key): a concurrent
      // identical push that lost the race returns no row here.
      .onConflictDoNothing({ target: [reports.sourceId, reports.idempotencyKey] })
      .returning();

    if (inserted.length === 0) {
      // Lost the idempotency race — the winner committed first (ON CONFLICT only
      // releases once the holder commits). Read its row via `tx`, not a separate
      // pooled connection, to avoid pool-exhaustion deadlocks inside the txn.
      // NOTE: the `existing!` non-null assertion is sound ONLY under READ
      // COMMITTED (the default): this reselect takes a fresh snapshot and sees
      // the just-committed winner. Do not raise the pool/txn isolation to
      // REPEATABLE READ/SERIALIZABLE without revisiting this branch.
      const [existing] = await tx
        .select()
        .from(reports)
        .where(and(eq(reports.sourceId, source.id), eq(reports.idempotencyKey, idempotencyKey)))
        .limit(1);
      return { status: 'duplicate', report: existing! };
    }

    const row = inserted[0];
    // Metric extraction runs ONLY for a genuinely new insert.
    await insertMetrics(tx, report, row.id, dest.stream.id, occurredAt);
    return { status: 'created', report: row, categoryId: dest.category.id };
  });

  // 6. Emit the post-commit ingestion event for genuine inserts only (never on
  //    an idempotent replay), then return the public result (sans `categoryId`).
  if (outcome.status === 'created') {
    bus.emitReportIngested({
      workspaceId: source.workspaceId,
      categoryId: outcome.categoryId,
      streamId: outcome.report.streamId,
      report: outcome.report,
    });
    return { status: 'created', report: outcome.report };
  }
  return outcome;
}
