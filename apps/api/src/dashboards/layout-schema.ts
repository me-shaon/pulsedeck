import { z } from 'zod';

/**
 * Dashboard `layout` JSONB contract (PRD "Dashboards & Navigation" — the
 * structured grid builder). This is the single, strict, versioned shape the
 * dashboard CRUD validates on write and the grid-builder UI consumes on read.
 *
 * Shape: a top-level `{ version, widgets[] }` object so the contract is
 * explicitly versioned (a future v2 can migrate stored layouts deterministically
 * rather than guessing from a bare array). Each widget carries a stable `id`, a
 * `type` (one of the five), a grid placement (`span` column-width + `row` order
 * index), and a `type`-specific `config`. Every object is `.strict()` so an
 * unknown field is REJECTED (422) rather than silently dropped — the contract is
 * a closed set, matching the PRD's "no arbitrary JSON chaos" principle.
 *
 * Widget config only ever references ids (streamId / categoryId / targetId) and
 * literal display options — never raw SQL — and the referenced ids are
 * additionally checked to belong to the workspace at write time (see
 * `services/dashboards.ts#collectLayoutRefs`), so a crafted config can never
 * point a widget at another workspace's data.
 */

/** Current layout contract version. Bumped only on a breaking shape change. */
export const LAYOUT_VERSION = 1;

/** Hard cap on widgets per dashboard — keeps a layout (and its render fan-out) bounded. */
export const MAX_WIDGETS = 50;

/** Column span on the responsive grid (full / half / third of 12 columns). */
export const spanSchema = z.enum(['full', 'half', 'third']);
export type WidgetSpan = z.infer<typeof spanSchema>;

/** Time window selector shared by chart / report_count widgets. */
export const rangeSchema = z.enum(['24h', '7d', '30d']);
export type WidgetRange = z.infer<typeof rangeSchema>;

const widgetId = z.string().min(1).max(64);
const idRef = z.string().min(1).max(64);
const metricKey = z.string().min(1).max(120);
const rowIndex = z.number().int().min(0).max(999);
const feedLimit = z.number().int().min(1).max(20);

/** stream_feed — latest N reports from a stream. */
export const streamFeedConfig = z.object({ streamId: idRef, limit: feedLimit }).strict();

/** metric — latest value of a metric `key` from a stream. */
export const metricConfig = z
  .object({ streamId: idRef, metricKey, label: z.string().max(120).optional() })
  .strict();

/** chart — time-series of a metric `key` across reports in a stream. */
export const chartConfig = z
  .object({
    streamId: idRef,
    metricKey,
    variant: z.enum(['line', 'bar', 'area']),
    range: rangeSchema.optional(),
  })
  .strict();

/** report_count — report volume over time for a stream or category. */
export const reportCountConfig = z
  .object({
    scope: z.enum(['stream', 'category']),
    targetId: idRef,
    bucket: z.enum(['day', 'hour']).optional(),
    range: rangeSchema.optional(),
  })
  .strict();

/** alert_feed — recent warning|critical reports from a category. */
export const alertFeedConfig = z.object({ categoryId: idRef, limit: feedLimit }).strict();

const widgetBase = { id: widgetId, span: spanSchema, row: rowIndex };

/**
 * A single widget — discriminated on `type`, so an unknown `type` (or a config
 * that doesn't match its type) fails validation with a clear path.
 */
export const widgetSchema = z.discriminatedUnion('type', [
  z.object({ ...widgetBase, type: z.literal('stream_feed'), config: streamFeedConfig }).strict(),
  z.object({ ...widgetBase, type: z.literal('metric'), config: metricConfig }).strict(),
  z.object({ ...widgetBase, type: z.literal('chart'), config: chartConfig }).strict(),
  z.object({ ...widgetBase, type: z.literal('report_count'), config: reportCountConfig }).strict(),
  z.object({ ...widgetBase, type: z.literal('alert_feed'), config: alertFeedConfig }).strict(),
]);

export type DashboardWidget = z.infer<typeof widgetSchema>;
export type WidgetType = DashboardWidget['type'];

/**
 * The full layout: a versioned envelope around the widget list. Widget ids must
 * be unique within a layout (the grid keys render + drag-reorder by id), so a
 * duplicate is rejected.
 */
export const dashboardLayoutSchema = z
  .object({
    version: z.literal(LAYOUT_VERSION),
    widgets: z.array(widgetSchema).max(MAX_WIDGETS),
  })
  .strict()
  .superRefine((layout, ctx) => {
    const seen = new Set<string>();
    layout.widgets.forEach((w, i) => {
      if (seen.has(w.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate widget id "${w.id}"`,
          path: ['widgets', i, 'id'],
        });
      }
      seen.add(w.id);
    });
  });

export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;

/** An empty, valid layout — the default for a freshly created dashboard. */
export function emptyLayout(): DashboardLayout {
  return { version: LAYOUT_VERSION, widgets: [] };
}

/**
 * Normalize a raw stored `layout` value into a valid {@link DashboardLayout}.
 *
 * The `dashboards.layout` column historically defaults to a bare `[]` array; a
 * row created outside this service (or before this contract existed) may hold an
 * array rather than the `{ version, widgets }` envelope. We coerce a bare array
 * into the envelope, then parse strictly; anything that still fails to validate
 * degrades to an empty layout so a malformed stored value can never crash a read
 * (writes always go through {@link dashboardLayoutSchema}, so this is defensive).
 */
export function normalizeLayout(raw: unknown): DashboardLayout {
  const candidate = Array.isArray(raw) ? { version: LAYOUT_VERSION, widgets: raw } : raw;
  const parsed = dashboardLayoutSchema.safeParse(candidate);
  return parsed.success ? parsed.data : emptyLayout();
}
