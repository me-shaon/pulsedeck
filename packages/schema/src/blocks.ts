import { z } from 'zod';
import {
  chartVariantSchema,
  columnTypeSchema,
  formatSchema,
  sentimentSchema,
  severitySchema,
  statusSchema,
  trendSchema,
} from './enums.js';
import { LIMITS } from './limits.js';

/**
 * The 8 PulseDeck block types (BLOCK_SCHEMA.md §4) plus the common envelope
 * (§2). Combined into a discriminated union on `type`, then wrapped with
 * cross-field validators (§4.3 chart, §4.4 table). In-schema ingestion limits
 * (§3) are applied per block via `.max(...)`.
 */

/** Common envelope shared by every block (BLOCK_SCHEMA.md §2). */
const envelope = {
  /** Unique within the report. */
  id: z.string().min(1),
  /** Optional section heading. */
  title: z.string().optional(),
  /** Optional muted subtext. */
  caption: z.string().optional(),
};

// ---------------------------------------------------------------------------
// 4.1 metric
// ---------------------------------------------------------------------------
export const metricBlockSchema = z.object({
  ...envelope,
  type: z.literal('metric'),
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number(),
  unit: z.string().optional(),
  format: formatSchema.optional(),
  precision: z.number().int().optional(),
  trend: trendSchema.optional(),
  sentiment: sentimentSchema.optional(),
  delta: z.number().optional(),
  comparison_label: z.string().optional(),
});
export type MetricBlock = z.infer<typeof metricBlockSchema>;

// ---------------------------------------------------------------------------
// 4.2 markdown
// ---------------------------------------------------------------------------
export const markdownBlockSchema = z.object({
  ...envelope,
  type: z.literal('markdown'),
  content: z.string().max(LIMITS.markdownChars),
});
export type MarkdownBlock = z.infer<typeof markdownBlockSchema>;

// ---------------------------------------------------------------------------
// 4.3 chart
// ---------------------------------------------------------------------------
export const chartSeriesSchema = z.object({
  name: z.string().min(1),
  data: z.array(z.number()).max(LIMITS.chartPointsPerSeries),
});
export type ChartSeries = z.infer<typeof chartSeriesSchema>;

export const chartBlockSchema = z.object({
  ...envelope,
  type: z.literal('chart'),
  variant: chartVariantSchema,
  labels: z.array(z.string()),
  x_axis: z.string().optional(),
  y_axis: z.string().optional(),
  unit: z.string().optional(),
  series: z.array(chartSeriesSchema).max(LIMITS.chartSeries),
});
export type ChartBlock = z.infer<typeof chartBlockSchema>;

// ---------------------------------------------------------------------------
// 4.4 table
// ---------------------------------------------------------------------------
export const tableColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  type: columnTypeSchema,
  unit: z.string().optional(),
});
export type TableColumn = z.infer<typeof tableColumnSchema>;

export const tableBlockSchema = z.object({
  ...envelope,
  type: z.literal('table'),
  columns: z.array(tableColumnSchema).max(LIMITS.tableColumns),
  rows: z.array(z.record(z.string(), z.unknown())).max(LIMITS.tableRows),
});
export type TableBlock = z.infer<typeof tableBlockSchema>;

// ---------------------------------------------------------------------------
// 4.5 timeline
// ---------------------------------------------------------------------------
export const timelineEventSchema = z.object({
  time: z.string().datetime({ offset: true }),
  label: z.string().min(1),
  description: z.string().optional(),
  status: statusSchema.optional(),
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export const timelineBlockSchema = z.object({
  ...envelope,
  type: z.literal('timeline'),
  events: z.array(timelineEventSchema),
});
export type TimelineBlock = z.infer<typeof timelineBlockSchema>;

// ---------------------------------------------------------------------------
// 4.6 alert
// ---------------------------------------------------------------------------
export const alertBlockSchema = z.object({
  ...envelope,
  type: z.literal('alert'),
  severity: severitySchema,
  // `title` is required for alert blocks (overrides the optional envelope title).
  title: z.string().min(1),
  message: z.string().optional(),
});
export type AlertBlock = z.infer<typeof alertBlockSchema>;

// ---------------------------------------------------------------------------
// 4.7 status
// ---------------------------------------------------------------------------
export const statusItemSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  status: statusSchema,
});
export type StatusItem = z.infer<typeof statusItemSchema>;

export const statusBlockSchema = z.object({
  ...envelope,
  type: z.literal('status'),
  items: z.array(statusItemSchema),
});
export type StatusBlock = z.infer<typeof statusBlockSchema>;

// ---------------------------------------------------------------------------
// 4.8 artifact
// ---------------------------------------------------------------------------
export const artifactBlockSchema = z.object({
  ...envelope,
  type: z.literal('artifact'),
  label: z.string().min(1),
  url: z.string().url(),
  mime_type: z.string().optional(),
  size_bytes: z.number().int().nonnegative().optional(),
});
export type ArtifactBlock = z.infer<typeof artifactBlockSchema>;

// ---------------------------------------------------------------------------
// Discriminated union + cross-field validators
// ---------------------------------------------------------------------------

/** Raw discriminated union (no cross-field refinement yet). */
const blockUnion = z.discriminatedUnion('type', [
  metricBlockSchema,
  markdownBlockSchema,
  chartBlockSchema,
  tableBlockSchema,
  timelineBlockSchema,
  alertBlockSchema,
  statusBlockSchema,
  artifactBlockSchema,
]);

/**
 * Block schema with cross-field validation layered on top:
 *  - chart: every `series[].data` length equals `labels` length.
 *  - table: every row's keys are a subset of the declared column `key`s.
 *
 * Issue paths are relative to the block (e.g. `series[0].data`); when nested
 * in a report they become `blocks[2].series[0].data`.
 */
export const blockSchema = blockUnion.superRefine((block, ctx) => {
  if (block.type === 'chart') {
    const labelCount = block.labels.length;
    block.series.forEach((s, i) => {
      if (s.data.length !== labelCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['series', i, 'data'],
          message: `Series data length (${s.data.length}) must match labels length (${labelCount})`,
        });
      }
    });
  }

  if (block.type === 'table') {
    const allowed = new Set(block.columns.map((c) => c.key));
    block.rows.forEach((row, i) => {
      for (const key of Object.keys(row)) {
        if (!allowed.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rows', i, key],
            message: `Unknown column key "${key}" (not declared in columns)`,
          });
        }
      }
    });
  }
});

export type Block =
  | MetricBlock
  | MarkdownBlock
  | ChartBlock
  | TableBlock
  | TimelineBlock
  | AlertBlock
  | StatusBlock
  | ArtifactBlock;

/** The 8 canonical block type discriminants. */
export const BLOCK_TYPES = [
  'metric',
  'markdown',
  'chart',
  'table',
  'timeline',
  'alert',
  'status',
  'artifact',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
