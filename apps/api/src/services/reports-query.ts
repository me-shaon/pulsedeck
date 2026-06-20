import type { Severity } from '@pulsedeck/schema';
import { and, arrayOverlaps, asc, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { categories, reports, sources, streams } from '../db/index.js';

/**
 * Read-side query + pagination logic for the report list, stream feed, report
 * detail, and the category→stream navigation tree (PRD "Report List & Detail",
 * "Categories & Streams", "Search"). Kept out of the route module so the HTTP
 * layer stays thin and the query correctness (keyset pagination, full-text
 * search, workspace scoping, N+1 avoidance) lives in one testable place.
 *
 * Workspace scoping is structural. The list query scopes on the denormalized
 * `reports.workspace_id` directly (Phase 11) so the workspace keyset index can
 * serve the sort; the detail/stream lookups still reach workspace via the
 * `reports → streams → categories` join. Either way a report/stream/category
 * from another workspace can never appear or be addressable. The route's
 * `reports:view` gate (allowed to all roles) plus this scoping mean any member
 * reads, a non-member 404s at the preHandler.
 */

const SEVERITIES: readonly Severity[] = ['info', 'warning', 'critical'];

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** Decoded keyset cursor: the boundary `(received_at, id)` to page past. */
export interface Cursor {
  /** Strict ISO-8601 UTC rendering of `received_at` with microsecond precision. */
  receivedAtText: string;
  id: string;
}

/** Parsed + validated list query parameters. */
export interface ListParams {
  limit: number;
  cursor: Cursor | null;
  /** Full-text query (websearch syntax) or null. */
  q: string | null;
  /** Category slug-or-id filter, resolved within the workspace. */
  category: string | null;
  /** Stream slug-or-id filter, resolved within the workspace. */
  stream: string | null;
  source: string | null;
  severity: Severity | null;
  /** Tag filter — ANY semantics (array overlap): a report matching any tag. */
  tags: string[];
  from: Date | null;
  to: Date | null;
}

/** A list item — a SUMMARY: never carries the full `blocks` JSONB. */
export interface ReportSummary {
  id: string;
  title: string;
  summary: string | null;
  severity: Severity | null;
  occurredAt: string;
  receivedAt: string;
  tags: string[];
  blockCount: number;
  source: { id: string; name: string };
  stream: { id: string; slug: string; name: string };
  category: { id: string; slug: string; name: string };
}

/**
 * Opaque keyset cursor: base64url of `<received_at ISO>|<id>`. The timestamp is
 * the microsecond-precision UTC rendering so the boundary is exact even when two
 * reports land in the same millisecond — a JS `Date` round-trip would truncate
 * to ms and risk skipping/duplicating a row across pages.
 */
export function encodeCursor(receivedAtText: string, id: string): string {
  return Buffer.from(`${receivedAtText}|${id}`, 'utf8').toString('base64url');
}

/** Exact shape `encodeCursor` emits: `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`. */
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** Decode a cursor, returning null when malformed (the route answers 400). */
export function decodeCursor(raw: string): Cursor | null {
  // `Buffer.from(_, 'base64url')` never throws — it silently drops invalid
  // characters — so garbage decodes to garbage and is caught by the checks below.
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = decoded.indexOf('|');
  if (sep <= 0) return null;
  const receivedAtText = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!id) return null;
  // Validate the timestamp against the EXACT emitted format, not just
  // `Date.parse`: a lax value like `2026` parses in JS but makes Postgres'
  // `::timestamptz` cast raise (→ a 500). Strict match keeps it a clean 400 and
  // means the cursor is always a self-generated token, never free-form input.
  if (!CURSOR_TS_RE.test(receivedAtText)) return null;
  return { receivedAtText, id };
}

/** Read a single string from a (possibly array-valued) query field. */
function single(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Collect tag values from repeated and/or comma-joined `tags` params. */
function collectTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    for (const part of item.split(',')) {
      const t = part.trim();
      if (t.length > 0) out.push(t);
    }
  }
  return out;
}

export type ParseResult = { ok: true; value: ListParams } | { ok: false; message: string };

/**
 * Parse + validate the list query string. Returns a discriminated result so the
 * route maps a failure to 400. All values become bound parameters downstream;
 * nothing here is interpolated into SQL.
 */
export function parseListQuery(query: Record<string, unknown>): ParseResult {
  // limit — default 25, clamp to [1, 100]; non-numeric is a client error.
  let limit = DEFAULT_LIMIT;
  const limitRaw = single(query.limit);
  if (limitRaw !== undefined) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1)
      return { ok: false, message: 'limit must be a positive integer' };
    limit = Math.min(n, MAX_LIMIT);
  }

  // cursor — opaque keyset token; malformed → 400.
  let cursor: Cursor | null = null;
  const cursorRaw = single(query.cursor);
  if (cursorRaw !== undefined) {
    cursor = decodeCursor(cursorRaw);
    if (!cursor) return { ok: false, message: 'malformed cursor' };
  }

  // severity — must be one of the canonical enum values.
  let severity: Severity | null = null;
  const sevRaw = single(query.severity);
  if (sevRaw !== undefined) {
    if (!SEVERITIES.includes(sevRaw as Severity)) {
      return { ok: false, message: `severity must be one of ${SEVERITIES.join(', ')}` };
    }
    severity = sevRaw as Severity;
  }

  // from / to — ISO-8601; invalid → 400.
  const from = parseDate(single(query.from));
  if (from === 'invalid') return { ok: false, message: 'from must be a valid ISO-8601 date' };
  const to = parseDate(single(query.to));
  if (to === 'invalid') return { ok: false, message: 'to must be a valid ISO-8601 date' };

  return {
    ok: true,
    value: {
      limit,
      cursor,
      q: single(query.q) ?? null,
      category: single(query.category) ?? null,
      stream: single(query.stream) ?? null,
      source: single(query.source) ?? null,
      severity,
      tags: collectTags(query.tags),
      from,
      to,
    },
  };
}

function parseDate(value: string | undefined): Date | null | 'invalid' {
  if (value === undefined) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

/**
 * Microsecond-precision, strict-ISO UTC rendering of `received_at`, selected
 * alongside the row so the keyset cursor is exact and the `::timestamptz`
 * round-trip in the next-page predicate is lossless.
 */
const cursorTsExpr = sql<string>`to_char(${reports.receivedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Block count without shipping the `blocks` JSONB to a list response. */
const blockCountExpr = sql<number>`jsonb_array_length(${reports.blocks})`;

/**
 * The column set every summary row selects (joined, so no per-row N+1).
 * INVARIANT: any raw `sql<T>` added here must be `string` or `number` only, and
 * `T` must match what postgres-js actually returns for that expression (e.g.
 * `count(...)::int` → number, `max(timestamptz)`/`to_char(...)` → string). A raw
 * `sql<Date>` would lie — the row type is asserted at the query boundary, so a
 * mismatch is silent until it blows up at use (see the `lastReportAt` fix).
 */
const summaryColumns = {
  id: reports.id,
  title: reports.title,
  summary: reports.summary,
  severity: reports.severity,
  occurredAt: reports.occurredAt,
  receivedAt: reports.receivedAt,
  tags: reports.tags,
  blockCount: blockCountExpr,
  cursorTs: cursorTsExpr,
  sourceId: sources.id,
  sourceName: sources.name,
  streamId: streams.id,
  streamSlug: streams.slug,
  streamName: streams.name,
  categoryId: categories.id,
  categorySlug: categories.slug,
  categoryName: categories.name,
};

type SummaryRow = {
  [K in keyof typeof summaryColumns]: K extends 'occurredAt' | 'receivedAt'
    ? Date
    : K extends 'severity'
      ? Severity | null
      : K extends 'summary'
        ? string | null
        : K extends 'tags'
          ? string[]
          : K extends 'blockCount'
            ? number
            : string;
};

function toSummary(row: SummaryRow): ReportSummary {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    severity: row.severity,
    occurredAt: row.occurredAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    tags: row.tags,
    blockCount: row.blockCount,
    source: { id: row.sourceId, name: row.sourceName },
    stream: { id: row.streamId, slug: row.streamSlug, name: row.streamName },
    category: { id: row.categoryId, slug: row.categorySlug, name: row.categoryName },
  };
}

/**
 * Build the shared WHERE conjunction for the list query: workspace scope, the
 * optional stream scope, the keyset boundary, full-text search, and every
 * filter. Each piece is a bound parameter — nothing is string-concatenated.
 *
 * Ordering decision: results are ALWAYS newest-first by `(received_at, id)` DESC,
 * even when `q` is present. We deliberately do NOT order by `ts_rank` — keyset
 * pagination requires a total, stable order over the tiebroken key, and
 * received_at ordering keeps search results paginating identically to an
 * unfiltered feed (and reuses the `(stream_id, received_at desc)` index for the
 * stream feed). Tags use ANY semantics (array overlap, `&&`).
 */
function listConditions(workspaceId: string, streamId: string | undefined, p: ListParams): SQL[] {
  // Scope directly on the denormalized `reports.workspace_id` (Phase 11), not
  // `categories.workspace_id` reached through the streams→categories join. This
  // lets the `(workspace_id, received_at DESC, id DESC)` composite index serve
  // the keyset ORDER BY without a full sort; the joins below remain ONLY to
  // project the stream/category/source summary names. The stream-feed path adds
  // `reports.stream_id = :streamId`, which still selects `(stream_id, received_at)`.
  const conditions: SQL[] = [eq(reports.workspaceId, workspaceId)];
  if (streamId) conditions.push(eq(reports.streamId, streamId));
  if (p.cursor) {
    conditions.push(
      sql`(${reports.receivedAt}, ${reports.id}) < (${p.cursor.receivedAtText}::timestamptz, ${p.cursor.id})`,
    );
  }
  if (p.q) {
    conditions.push(sql`${reports.searchVector} @@ websearch_to_tsquery('english', ${p.q})`);
  }
  if (p.category) {
    conditions.push(or(eq(categories.id, p.category), eq(categories.slug, p.category)) as SQL);
  }
  if (p.stream) {
    conditions.push(or(eq(streams.id, p.stream), eq(streams.slug, p.stream)) as SQL);
  }
  if (p.source) conditions.push(eq(reports.sourceId, p.source));
  if (p.severity) conditions.push(eq(reports.severity, p.severity));
  if (p.tags.length > 0) conditions.push(arrayOverlaps(reports.tags, p.tags));
  if (p.from) conditions.push(gte(reports.receivedAt, p.from));
  if (p.to) conditions.push(lte(reports.receivedAt, p.to));
  return conditions;
}

/**
 * Run the report list query with keyset pagination. Fetches `limit + 1` rows:
 * the extra row signals (and seeds the cursor for) a next page without a second
 * COUNT query. `streamId`, when given, scopes to a single stream feed.
 */
export async function listReports(
  db: Db,
  opts: { workspaceId: string; streamId?: string; params: ListParams },
): Promise<{ reports: ReportSummary[]; nextCursor: string | null }> {
  const { workspaceId, streamId, params } = opts;
  const rows = (await db
    .select(summaryColumns)
    .from(reports)
    .innerJoin(streams, eq(streams.id, reports.streamId))
    .innerJoin(categories, eq(categories.id, streams.categoryId))
    .innerJoin(sources, eq(sources.id, reports.sourceId))
    .where(and(...listConditions(workspaceId, streamId, params)))
    .orderBy(desc(reports.receivedAt), desc(reports.id))
    .limit(params.limit + 1)) as unknown as SummaryRow[];

  let nextCursor: string | null = null;
  let visible = rows;
  if (rows.length > params.limit) {
    visible = rows.slice(0, params.limit);
    const last = visible[visible.length - 1];
    nextCursor = encodeCursor(last.cursorTs, last.id);
  }
  return { reports: visible.map(toSummary), nextCursor };
}

/** True when `streamId` belongs to `workspaceId` (else the caller 404s). */
export async function streamInWorkspace(
  db: Db,
  workspaceId: string,
  streamId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: streams.id })
    .from(streams)
    .innerJoin(categories, eq(categories.id, streams.categoryId))
    .where(and(eq(streams.id, streamId), eq(categories.workspaceId, workspaceId)))
    .limit(1);
  return Boolean(row);
}

/** Full report detail (all blocks + metadata) plus permalink prev/next. */
export interface ReportDetail {
  report: {
    id: string;
    title: string;
    summary: string | null;
    severity: Severity | null;
    occurredAt: string;
    receivedAt: string;
    createdAt: string;
    tags: string[];
    blocks: unknown[];
    source: { id: string; name: string };
    stream: { id: string; slug: string; name: string };
    category: { id: string; slug: string; name: string };
  };
  /** The newer neighbour in the stream (toward the top of the newest-first list). */
  prevReportId: string | null;
  /** The older neighbour in the stream (toward the bottom of the list). */
  nextReportId: string | null;
}

/**
 * Fetch a single report by id, scoped to the workspace (404 → null when the
 * report is not in this workspace), with its full `blocks` and metadata plus the
 * prev/next report ids within the same stream for permalink navigation.
 *
 * prev/next convention (matches the newest-first list): `prev` is the NEWER
 * neighbour (received_at just above), `next` is the OLDER one. So the newest
 * report in a stream has `prev = null` and the oldest has `next = null`.
 */
export async function getReportDetail(
  db: Db,
  opts: { workspaceId: string; reportId: string },
): Promise<ReportDetail | null> {
  const { workspaceId, reportId } = opts;
  const [row] = (await db
    .select({
      id: reports.id,
      title: reports.title,
      summary: reports.summary,
      severity: reports.severity,
      occurredAt: reports.occurredAt,
      receivedAt: reports.receivedAt,
      createdAt: reports.createdAt,
      tags: reports.tags,
      blocks: reports.blocks,
      cursorTs: cursorTsExpr,
      streamId: streams.id,
      streamSlug: streams.slug,
      streamName: streams.name,
      sourceId: sources.id,
      sourceName: sources.name,
      categoryId: categories.id,
      categorySlug: categories.slug,
      categoryName: categories.name,
    })
    .from(reports)
    .innerJoin(streams, eq(streams.id, reports.streamId))
    .innerJoin(categories, eq(categories.id, streams.categoryId))
    .innerJoin(sources, eq(sources.id, reports.sourceId))
    .where(and(eq(reports.id, reportId), eq(categories.workspaceId, workspaceId)))
    .limit(1)) as unknown as Array<{
    id: string;
    title: string;
    summary: string | null;
    severity: Severity | null;
    occurredAt: Date;
    receivedAt: Date;
    createdAt: Date;
    tags: string[];
    blocks: unknown[];
    cursorTs: string;
    streamId: string;
    streamSlug: string;
    streamName: string;
    sourceId: string;
    sourceName: string;
    categoryId: string;
    categorySlug: string;
    categoryName: string;
  }>;

  if (!row) return null;

  const [prev] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.streamId, row.streamId),
        sql`(${reports.receivedAt}, ${reports.id}) > (${row.cursorTs}::timestamptz, ${row.id})`,
      ),
    )
    .orderBy(asc(reports.receivedAt), asc(reports.id))
    .limit(1);

  const [next] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.streamId, row.streamId),
        sql`(${reports.receivedAt}, ${reports.id}) < (${row.cursorTs}::timestamptz, ${row.id})`,
      ),
    )
    .orderBy(desc(reports.receivedAt), desc(reports.id))
    .limit(1);

  return {
    report: {
      id: row.id,
      title: row.title,
      summary: row.summary,
      severity: row.severity,
      occurredAt: row.occurredAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      tags: row.tags,
      blocks: row.blocks,
      source: { id: row.sourceId, name: row.sourceName },
      stream: { id: row.streamId, slug: row.streamSlug, name: row.streamName },
      category: { id: row.categoryId, slug: row.categorySlug, name: row.categoryName },
    },
    prevReportId: prev?.id ?? null,
    nextReportId: next?.id ?? null,
  };
}

/** A stream node in the navigation tree. */
export interface TreeStream {
  id: string;
  slug: string;
  name: string;
  position: number;
  reportCount: number;
  lastReportAt: string | null;
}

/** A category node with its ordered streams. */
export interface TreeCategory {
  id: string;
  slug: string;
  name: string;
  position: number;
  streams: TreeStream[];
}

/**
 * Build the auto-generated category→stream navigation tree (PRD "Sidebar"):
 * categories ordered by (position, name), each with its streams ordered the same
 * way, plus per-stream report count and last-report time.
 *
 * Two queries (categories, then streams with a grouped LEFT JOIN over reports)
 * rather than per-stream count lookups — no N+1. `count(...)::int` keeps the
 * aggregate a JS number (bigint would arrive as a string); `max(received_at)` is
 * null for an empty stream.
 */
export async function getTree(db: Db, workspaceId: string): Promise<TreeCategory[]> {
  const cats = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      position: categories.position,
    })
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId))
    .orderBy(asc(categories.position), asc(categories.name));

  const streamRows = (await db
    .select({
      id: streams.id,
      slug: streams.slug,
      name: streams.name,
      position: streams.position,
      categoryId: streams.categoryId,
      reportCount: sql<number>`count(${reports.id})::int`,
      // A raw `max(timestamptz)` comes back as a string from postgres-js (no
      // column-level parser applies to a bare sql expression), so type it as
      // string and normalize to ISO below — never call Date methods on it raw.
      lastReportAt: sql<string | null>`max(${reports.receivedAt})`,
    })
    .from(streams)
    .innerJoin(categories, eq(categories.id, streams.categoryId))
    .leftJoin(reports, eq(reports.streamId, streams.id))
    .where(eq(categories.workspaceId, workspaceId))
    .groupBy(streams.id)
    .orderBy(asc(streams.position), asc(streams.name))) as unknown as Array<{
    id: string;
    slug: string;
    name: string;
    position: number;
    categoryId: string;
    reportCount: number;
    lastReportAt: string | null;
  }>;

  const byCategory = new Map<string, TreeStream[]>();
  for (const s of streamRows) {
    const list = byCategory.get(s.categoryId) ?? [];
    list.push({
      id: s.id,
      slug: s.slug,
      name: s.name,
      position: s.position,
      reportCount: s.reportCount,
      lastReportAt: s.lastReportAt ? new Date(s.lastReportAt).toISOString() : null,
    });
    byCategory.set(s.categoryId, list);
  }

  return cats.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    position: c.position,
    streams: byCategory.get(c.id) ?? [],
  }));
}
