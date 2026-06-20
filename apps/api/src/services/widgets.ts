import type { Severity } from '@pulsedeck/schema';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { WidgetRange } from '../dashboards/layout-schema.js';
import type { Db } from '../db/index.js';
import { categories, reportMetrics, reports, streams } from '../db/index.js';

/**
 * Widget-data queries (PRD "Dashboards & Navigation"). The grid renders by
 * calling these endpoints; each reads the FLAT, INDEXED tables — never a JSONB
 * scan across thousands of reports.
 *
 * Index usage:
 *   - metric latest + chart series read `report_metrics` with equality on
 *     `(stream_id, key)` and an ordering/range on `occurred_at`, hitting the
 *     `report_metrics_stream_key_occurred_idx (stream_id, key, occurred_at)` btree.
 *   - report_count groups `reports` by `date_trunc(bucket, received_at)`, scoped
 *     by an `IN (stream_ids)` set (the category's streams are resolved first),
 *     riding `reports_stream_received_idx`.
 *   - alert_feed reuses the `reports_stream_received_idx` ordering per stream.
 *
 * Everything is workspace-scoped (the route verifies the stream/category belongs
 * to the workspace before calling) and fully parameterized — `key`, `range`, and
 * `bucket` are bound values or validated enums, never interpolated into SQL.
 */

/** Map a range token to its millisecond window. */
const RANGE_MS: Record<WidgetRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/** Cap on points returned by a series query (PRD-style bounded fan-out). */
export const MAX_SERIES_POINTS = 500;
/** Cap on rows an alert feed returns. */
export const MAX_ALERT_FEED = 20;

export const DEFAULT_RANGE: WidgetRange = '7d';
export type CountBucket = 'day' | 'hour';
export const DEFAULT_BUCKET: CountBucket = 'day';

/** Parse a `range` query value → token, default, or 'invalid' (route → 400). */
export function parseRange(value: unknown): WidgetRange | 'invalid' {
  if (value === undefined) return DEFAULT_RANGE;
  if (value === '24h' || value === '7d' || value === '30d') return value;
  return 'invalid';
}

/** Parse a `bucket` query value → token, default, or 'invalid'. */
export function parseBucket(value: unknown): CountBucket | 'invalid' {
  if (value === undefined) return DEFAULT_BUCKET;
  if (value === 'day' || value === 'hour') return value;
  return 'invalid';
}

/** A cutoff `Date` for a range, measured back from now (server time). */
function cutoff(range: WidgetRange): Date {
  return new Date(Date.now() - RANGE_MS[range]);
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

/** True when `categoryId` belongs to `workspaceId`. */
export async function categoryInWorkspace(
  db: Db,
  workspaceId: string,
  categoryId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.workspaceId, workspaceId)))
    .limit(1);
  return Boolean(row);
}

/** One metric sample. */
export interface MetricPoint {
  value: number;
  occurredAt: string;
}

/** Latest metric value for a `(stream, key)` plus the previous value + delta. */
export interface MetricLatest {
  streamId: string;
  metricKey: string;
  latest: MetricPoint | null;
  previous: MetricPoint | null;
  /** `latest.value - previous.value` when both exist, else null. */
  delta: number | null;
}

/**
 * Most-recent metric sample for `(stream, key)` + the one before it for a delta.
 * Reads the two newest `report_metrics` rows — an index range-scan + LIMIT 2 on
 * `(stream_id, key, occurred_at DESC)`, no JSONB scan.
 */
export async function getMetricLatest(
  db: Db,
  streamId: string,
  key: string,
): Promise<MetricLatest> {
  const rows = (await db
    .select({ value: reportMetrics.value, occurredAt: reportMetrics.occurredAt })
    .from(reportMetrics)
    .where(and(eq(reportMetrics.streamId, streamId), eq(reportMetrics.key, key)))
    .orderBy(desc(reportMetrics.occurredAt), desc(reportMetrics.id))
    .limit(2)) as unknown as Array<{ value: number; occurredAt: Date }>;

  const latest = rows[0]
    ? { value: rows[0].value, occurredAt: rows[0].occurredAt.toISOString() }
    : null;
  const previous = rows[1]
    ? { value: rows[1].value, occurredAt: rows[1].occurredAt.toISOString() }
    : null;
  const delta = latest && previous ? latest.value - previous.value : null;

  return { streamId, metricKey: key, latest, previous, delta };
}

/** A metric time-series within a range. */
export interface MetricSeries {
  streamId: string;
  metricKey: string;
  range: WidgetRange;
  points: MetricPoint[];
  /** True when the point count hit {@link MAX_SERIES_POINTS} (truncated). */
  truncated: boolean;
}

/**
 * Ordered (oldest→newest) `{ occurredAt, value }[]` for `(stream, key)` within
 * `range`, the shape a chart wants. The `occurred_at >= cutoff` predicate with
 * equality on `(stream_id, key)` is an index range-scan over
 * `(stream_id, key, occurred_at)`. On pathological volumes the cap keeps the
 * MOST RECENT {@link MAX_SERIES_POINTS} (fetch newest-first, then reverse), so a
 * chart shows the latest window rather than dropping it.
 */
export async function getMetricSeries(
  db: Db,
  streamId: string,
  key: string,
  range: WidgetRange,
): Promise<MetricSeries> {
  const rows = (await db
    .select({ value: reportMetrics.value, occurredAt: reportMetrics.occurredAt })
    .from(reportMetrics)
    .where(
      and(
        eq(reportMetrics.streamId, streamId),
        eq(reportMetrics.key, key),
        gte(reportMetrics.occurredAt, cutoff(range)),
      ),
    )
    .orderBy(desc(reportMetrics.occurredAt), desc(reportMetrics.id))
    .limit(MAX_SERIES_POINTS + 1)) as unknown as Array<{ value: number; occurredAt: Date }>;

  const truncated = rows.length > MAX_SERIES_POINTS;
  // Keep the newest N, then reverse to oldest→newest for plotting.
  const visible = (truncated ? rows.slice(0, MAX_SERIES_POINTS) : rows).reverse();
  return {
    streamId,
    metricKey: key,
    range,
    points: visible.map((r) => ({ value: r.value, occurredAt: r.occurredAt.toISOString() })),
    truncated,
  };
}

/** One time bucket of report volume. */
export interface CountBucketRow {
  bucket: string;
  count: number;
}

export interface ReportCount {
  scope: 'stream' | 'category';
  targetId: string;
  bucket: CountBucket;
  range: WidgetRange;
  buckets: CountBucketRow[];
}

/**
 * Time-bucketed report volume for a stream or a category within `range`. Counts
 * are grouped by `date_trunc(:bucket, received_at)` (server time) and scoped to
 * the workspace via the target's membership (verified by the route). `bucket` is
 * a validated enum embedded as a literal in `date_trunc`; the target id and
 * cutoff are bound parameters.
 */
export async function getReportCount(
  db: Db,
  opts: {
    scope: 'stream' | 'category';
    targetId: string;
    bucket: CountBucket;
    range: WidgetRange;
  },
): Promise<ReportCount> {
  const { scope, targetId, bucket, range } = opts;
  // `date_trunc(text, timestamp)` takes its field as a TEXT argument, so `bucket`
  // (a validated 'day'|'hour' enum) is passed as a BOUND parameter — never
  // interpolated. The explicit `::text` cast is required: an un-cast bound param
  // has unknown type, so Postgres can't resolve which `date_trunc` overload to
  // call (→ a 500).
  const bucketExpr = sql<string>`to_char(date_trunc(${bucket}::text, ${reports.receivedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
  const since = cutoff(range);

  // Resolve the target to a concrete set of stream ids, so the count query has a
  // single uniform shape (no conditional join) and stays on
  // `reports_stream_received_idx`. A category with no streams → empty result.
  let streamIds: string[];
  if (scope === 'stream') {
    streamIds = [targetId];
  } else {
    const rows = await db
      .select({ id: streams.id })
      .from(streams)
      .where(eq(streams.categoryId, targetId));
    streamIds = rows.map((r) => r.id);
  }
  if (streamIds.length === 0) {
    return { scope, targetId, bucket, range, buckets: [] };
  }

  // Group/order by the SELECT ordinal (the bucket is column 1). Repeating the
  // bound-param `bucketExpr` in GROUP BY makes Postgres treat it as a distinct
  // expression (→ "received_at must appear in GROUP BY"); the ordinal avoids that.
  const rows = (await db
    .select({ bucket: bucketExpr, count: sql<number>`count(*)::int` })
    .from(reports)
    .where(and(inArray(reports.streamId, streamIds), gte(reports.receivedAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`)) as unknown as Array<{ bucket: string; count: number }>;

  return { scope, targetId, bucket, range, buckets: rows };
}

/** An alert-feed item — a compact report summary. */
export interface AlertItem {
  id: string;
  title: string;
  summary: string | null;
  severity: Severity | null;
  occurredAt: string;
  receivedAt: string;
  tags: string[];
  stream: { id: string; slug: string; name: string };
}

/**
 * Recent "alerts" in a category, newest-first. We define an alert as a report
 * whose `severity` is `warning` or `critical` (the simplest, index-friendly
 * signal — no JSONB block scan), scoped to the category's streams. Capped at
 * {@link MAX_ALERT_FEED}.
 */
export async function getAlertFeed(
  db: Db,
  categoryId: string,
  limit: number,
): Promise<AlertItem[]> {
  const severities: Severity[] = ['warning', 'critical'];
  const rows = (await db
    .select({
      id: reports.id,
      title: reports.title,
      summary: reports.summary,
      severity: reports.severity,
      occurredAt: reports.occurredAt,
      receivedAt: reports.receivedAt,
      tags: reports.tags,
      streamId: streams.id,
      streamSlug: streams.slug,
      streamName: streams.name,
    })
    .from(reports)
    .innerJoin(streams, eq(streams.id, reports.streamId))
    .where(and(eq(streams.categoryId, categoryId), inArray(reports.severity, severities)))
    .orderBy(desc(reports.receivedAt), desc(reports.id))
    .limit(Math.min(limit, MAX_ALERT_FEED))) as unknown as Array<{
    id: string;
    title: string;
    summary: string | null;
    severity: Severity | null;
    occurredAt: Date;
    receivedAt: Date;
    tags: string[];
    streamId: string;
    streamSlug: string;
    streamName: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    severity: r.severity,
    occurredAt: r.occurredAt.toISOString(),
    receivedAt: r.receivedAt.toISOString(),
    tags: r.tags,
    stream: { id: r.streamId, slug: r.streamSlug, name: r.streamName },
  }));
}
