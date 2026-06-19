/**
 * `@pulsedeck/schema` — the single source of truth for the PulseDeck report
 * wire contract. The backend validates ingested reports with these schemas and
 * the frontend renders from the inferred types. See BLOCK_SCHEMA.md and the PRD
 * "Canonical Report Schema" / "Validation Feedback" sections.
 */

export { SCHEMA_VERSION, type SchemaVersion } from './version.js';

export { LIMITS, MAX_PAYLOAD_BYTES, type Limits } from './limits.js';

export {
  severitySchema,
  statusSchema,
  trendSchema,
  sentimentSchema,
  formatSchema,
  chartVariantSchema,
  columnTypeSchema,
  type Severity,
  type Status,
  type Trend,
  type Sentiment,
  type Format,
  type ChartVariant,
  type ColumnType,
} from './enums.js';

export {
  metricBlockSchema,
  markdownBlockSchema,
  chartBlockSchema,
  chartSeriesSchema,
  tableBlockSchema,
  tableColumnSchema,
  timelineBlockSchema,
  timelineEventSchema,
  alertBlockSchema,
  statusBlockSchema,
  statusItemSchema,
  artifactBlockSchema,
  blockSchema,
  blockSchemasByType,
  BLOCK_TYPES,
  type MetricBlock,
  type MarkdownBlock,
  type ChartBlock,
  type ChartSeries,
  type TableBlock,
  type TableColumn,
  type TimelineBlock,
  type TimelineEvent,
  type AlertBlock,
  type StatusBlock,
  type StatusItem,
  type ArtifactBlock,
  type Block,
  type BlockType,
} from './blocks.js';

export { reportSchema, reportMetaSchema, type Report, type ReportMeta } from './report.js';

export { toIssues, formatPath, validateReport, type Issue, type ValidateResult } from './issues.js';

export {
  schemaInfo,
  getSchemaInfo,
  type SchemaInfo,
  type BlockInfo,
  type FieldInfo,
} from './schema-info.js';
