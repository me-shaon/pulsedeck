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
import { SCHEMA_VERSION } from './version.js';

/**
 * Hand-authored, dependency-free description of the wire contract, mirroring
 * BLOCK_SCHEMA.md. Plain JSON suitable for `GET /api/v1/schema` and the agent
 * setup prompt. Kept as data (not generated from Zod) so it stays human-curated
 * and free of zod-to-json-schema coupling.
 */

export interface FieldInfo {
  name: string;
  required: boolean;
  /** Coarse type hint or a reference like `enum:severity`. */
  type: string;
  description: string;
}

export interface BlockInfo {
  type: string;
  description: string;
  fields: FieldInfo[];
}

export interface SchemaInfo {
  version: string;
  enums: Record<string, readonly string[]>;
  limits: typeof LIMITS;
  /** Fields of the report envelope (excluding `blocks`). */
  reportEnvelope: FieldInfo[];
  blocks: BlockInfo[];
}

export const schemaInfo: SchemaInfo = {
  version: SCHEMA_VERSION,
  // Derived from the Zod enums so the descriptor can never drift from validation.
  enums: {
    severity: severitySchema.options,
    status: statusSchema.options,
    trend: trendSchema.options,
    sentiment: sentimentSchema.options,
    format: formatSchema.options,
    chart_variant: chartVariantSchema.options,
    column_type: columnTypeSchema.options,
  },
  limits: LIMITS,
  reportEnvelope: [
    {
      name: 'version',
      required: true,
      type: `literal:${SCHEMA_VERSION}`,
      description: 'Wire contract version.',
    },
    {
      name: 'workspace',
      required: false,
      type: 'string',
      description: 'Optional workspace slug hint.',
    },
    { name: 'source.id', required: true, type: 'string', description: 'Registered source id.' },
    { name: 'category.slug', required: true, type: 'string', description: 'Target category slug.' },
    { name: 'stream.slug', required: true, type: 'string', description: 'Target stream slug.' },
    { name: 'report.title', required: true, type: 'string', description: 'Report title.' },
    { name: 'report.summary', required: false, type: 'string', description: 'Short summary.' },
    {
      name: 'report.severity',
      required: false,
      type: 'enum:severity',
      description: 'Overall report severity.',
    },
    {
      name: 'report.occurred_at',
      required: true,
      type: 'datetime',
      description: 'ISO 8601 timestamp the report is about.',
    },
    { name: 'report.tags', required: false, type: 'string[]', description: 'Free-form tags.' },
    {
      name: 'blocks',
      required: true,
      type: 'block[]',
      description: `Ordered blocks (<= ${LIMITS.blocksPerReport}).`,
    },
  ],
  blocks: [
    {
      type: 'metric',
      description: 'A single numeric metric with trend, sentiment and comparison.',
      fields: [
        { name: 'id', required: true, type: 'string', description: 'Unique within the report.' },
        { name: 'type', required: true, type: 'literal:metric', description: 'Block type.' },
        { name: 'title', required: false, type: 'string', description: 'Section heading.' },
        { name: 'caption', required: false, type: 'string', description: 'Muted subtext.' },
        {
          name: 'key',
          required: true,
          type: 'string',
          description: 'Stable machine id, constant across reports.',
        },
        { name: 'label', required: true, type: 'string', description: 'Human display name.' },
        { name: 'value', required: true, type: 'number', description: 'The metric value.' },
        { name: 'unit', required: false, type: 'string', description: 'Unit suffix (e.g. ms).' },
        {
          name: 'format',
          required: false,
          type: 'enum:format',
          description: 'Number format, default number.',
        },
        { name: 'precision', required: false, type: 'integer', description: 'Decimal places.' },
        { name: 'trend', required: false, type: 'enum:trend', description: 'Direction arrow.' },
        {
          name: 'sentiment',
          required: false,
          type: 'enum:sentiment',
          description: 'Color meaning.',
        },
        { name: 'delta', required: false, type: 'number', description: 'Change vs comparison.' },
        {
          name: 'comparison_label',
          required: false,
          type: 'string',
          description: 'Comparison label (e.g. vs yesterday).',
        },
      ],
    },
    {
      type: 'markdown',
      description: 'A markdown text block (raw HTML disabled when rendered).',
      fields: [
        { name: 'id', required: true, type: 'string', description: 'Unique within the report.' },
        { name: 'type', required: true, type: 'literal:markdown', description: 'Block type.' },
        { name: 'title', required: false, type: 'string', description: 'Section heading.' },
        { name: 'caption', required: false, type: 'string', description: 'Muted subtext.' },
        {
          name: 'content',
          required: true,
          type: 'string',
          description: `Markdown string (<= ${LIMITS.markdownChars} chars).`,
        },
      ],
    },
    {
      type: 'chart',
      description: 'A line/bar/area chart. Each series data length matches labels length.',
      fields: [
        { name: 'id', required: true, type: 'string', description: 'Unique within the report.' },
        { name: 'type', required: true, type: 'literal:chart', description: 'Block type.' },
        { name: 'title', required: false, type: 'string', description: 'Chart title.' },
        { name: 'caption', required: false, type: 'string', description: 'Muted subtext.' },
        {
          name: 'variant',
          required: true,
          type: 'enum:chart_variant',
          description: 'Chart geometry.',
        },
        {
          name: 'labels',
          required: true,
          type: 'string[]',
          description: 'X-axis values; ISO 8601 allowed.',
        },
        { name: 'x_axis', required: false, type: 'string', description: 'X-axis label.' },
        { name: 'y_axis', required: false, type: 'string', description: 'Y-axis label.' },
        { name: 'unit', required: false, type: 'string', description: 'Series unit.' },
        {
          name: 'series',
          required: true,
          type: '{ name, data[] }[]',
          description: `Series (<= ${LIMITS.chartSeries}); each data <= ${LIMITS.chartPointsPerSeries} points and equal to labels length.`,
        },
      ],
    },
    {
      type: 'table',
      description: 'A typed-column, keyed-row table. Row keys must be declared columns.',
      fields: [
        { name: 'id', required: true, type: 'string', description: 'Unique within the report.' },
        { name: 'type', required: true, type: 'literal:table', description: 'Block type.' },
        { name: 'title', required: false, type: 'string', description: 'Section heading.' },
        { name: 'caption', required: false, type: 'string', description: 'Muted subtext.' },
        {
          name: 'columns',
          required: true,
          type: '{ key, label, type, unit? }[]',
          description: `Typed columns (<= ${LIMITS.tableColumns}); type is column_type.`,
        },
        {
          name: 'rows',
          required: true,
          type: 'object[]',
          description: `Rows keyed by column key (<= ${LIMITS.tableRows}).`,
        },
      ],
    },
    {
      type: 'timeline',
      description: 'A chronological list of events.',
      fields: [
        { name: 'id', required: true, type: 'string', description: 'Unique within the report.' },
        { name: 'type', required: true, type: 'literal:timeline', description: 'Block type.' },
        { name: 'title', required: false, type: 'string', description: 'Section heading.' },
        { name: 'caption', required: false, type: 'string', description: 'Muted subtext.' },
        {
          name: 'events',
          required: true,
          type: '{ time, label, description?, status? }[]',
          description: 'Events; time is ISO 8601, status is the status enum.',
        },
      ],
    },
    {
      type: 'alert',
      description: 'A severity-tagged alert banner.',
      fields: [
        { name: 'id', required: true, type: 'string', description: 'Unique within the report.' },
        { name: 'type', required: true, type: 'literal:alert', description: 'Block type.' },
        { name: 'caption', required: false, type: 'string', description: 'Muted subtext.' },
        { name: 'severity', required: true, type: 'enum:severity', description: 'Alert severity.' },
        { name: 'title', required: true, type: 'string', description: 'Alert title.' },
        { name: 'message', required: false, type: 'string', description: 'Alert detail.' },
      ],
    },
    {
      type: 'status',
      description: 'A grid of keyed status items.',
      fields: [
        { name: 'id', required: true, type: 'string', description: 'Unique within the report.' },
        { name: 'type', required: true, type: 'literal:status', description: 'Block type.' },
        { name: 'title', required: false, type: 'string', description: 'Section heading.' },
        { name: 'caption', required: false, type: 'string', description: 'Muted subtext.' },
        {
          name: 'items',
          required: true,
          type: '{ key, label, status }[]',
          description: 'Status items; status is the status enum.',
        },
      ],
    },
    {
      type: 'artifact',
      description: 'A drill-down link to the full underlying data.',
      fields: [
        { name: 'id', required: true, type: 'string', description: 'Unique within the report.' },
        { name: 'type', required: true, type: 'literal:artifact', description: 'Block type.' },
        { name: 'title', required: false, type: 'string', description: 'Section heading.' },
        { name: 'caption', required: false, type: 'string', description: 'Muted subtext.' },
        {
          name: 'label',
          required: true,
          type: 'string',
          description: 'Display label for the link.',
        },
        {
          name: 'url',
          required: true,
          type: 'url',
          description: 'Link target (never fetched server-side).',
        },
        { name: 'mime_type', required: false, type: 'string', description: 'MIME type hint.' },
        {
          name: 'size_bytes',
          required: false,
          type: 'integer',
          description: 'File size in bytes.',
        },
      ],
    },
  ],
};

/** Returns the schema descriptor (stable reference). */
export function getSchemaInfo(): SchemaInfo {
  return schemaInfo;
}
