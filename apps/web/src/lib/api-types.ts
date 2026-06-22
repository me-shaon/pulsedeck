import type { Block, Severity } from '@pulsedeck/schema';

/**
 * Wire shapes returned by the PulseDeck read/write APIs (apps/api).
 *
 * NOTE: these are the *server projections* the dashboard consumes — distinct
 * from the ingestion wire schema in `@pulsedeck/schema` (which describes the
 * shape an agent pushes). Block bodies are the one shared piece, so we reuse
 * `Block` from the schema package for `ReportDetail.blocks`.
 */

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type SourceScope = 'workspace' | 'category' | 'stream';
export type SourceStatus = 'active' | 'stale' | 'never';

export type SignupMode = 'setup' | 'open' | 'invite';

export interface AuthConfig {
  githubEnabled: boolean;
  setupRequired: boolean;
  /** How new accounts/users may be created (drives signup UI). */
  signupMode: SignupMode;
  /** Whether billing UI is active. OSS → false (hide all billing/usage UI). */
  billingEnabled: boolean;
}

/**
 * The caller's billing account: limits + current usage. `null` on any limit
 * means unlimited (OSS) → the web renders no meters/upgrade prompts; cloud
 * returns real numbers and the same components show usage.
 */
export interface AccountLimits {
  retentionDays: number | null;
  maxSeats: number | null;
  maxWorkspaces: number | null;
}

export interface AccountUsage {
  workspaces: number;
  seats: number;
}

export interface Account {
  id: string;
  limits: AccountLimits;
  usage: AccountUsage;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  defaultDashboardId?: string | null;
  role?: Role;
  createdAt?: string;
}

export interface WorkspaceListItem {
  id: string;
  name: string;
  slug: string;
  role: Role;
  createdAt: string;
}

export interface Member {
  userId: string;
  role: Role;
  email: string;
  name: string | null;
}

export interface Invite {
  id: string;
  role: Role;
  email: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface CreatedInvite {
  id: string;
  role: Role;
  email: string | null;
  token: string;
  expiresAt: string;
  inviteUrl: string;
}

export interface Source {
  id: string;
  name: string;
  scope: SourceScope;
  agentVersion: string | null;
  schemaVersion: string;
  lastSeenAt: string | null;
  reportCount: number;
  status: SourceStatus;
}

export interface CreatedSource {
  source: {
    id: string;
    name: string;
    scope: SourceScope;
    allowStreamAutocreate: boolean;
    createdAt: string;
  };
  registrationToken: string;
  setupPrompt: string;
  schema: unknown;
  baseUrlNote?: string;
}

export interface ReissuedToken {
  source: { id: string; name: string };
  registrationToken: string;
  setupPrompt: string;
  schema: unknown;
  baseUrlNote?: string;
}

export interface RotatedKey {
  source_id: string;
  api_key: string;
}

/** A report's brief reference to its owning entities. */
export interface ReportRef {
  id: string;
  name: string;
}
export interface StreamRef {
  id: string;
  slug: string;
  name: string;
}
export interface CategoryRef {
  id: string;
  slug: string;
  name: string;
}

export interface ReportSummary {
  id: string;
  title: string;
  summary: string | null;
  severity: Severity | null;
  occurredAt: string;
  receivedAt: string;
  tags: string[];
  blockCount: number;
  source: ReportRef;
  stream: StreamRef;
  category: CategoryRef;
}

export interface ReportPage {
  reports: ReportSummary[];
  nextCursor: string | null;
}

export interface ReportDetail {
  id: string;
  title: string;
  summary: string | null;
  severity: Severity | null;
  occurredAt: string;
  receivedAt: string;
  createdAt: string;
  tags: string[];
  blocks: Block[];
  source: ReportRef;
  stream: StreamRef;
  category: CategoryRef;
}

export interface ReportDetailResponse {
  report: ReportDetail;
  prevReportId: string | null;
  nextReportId: string | null;
}

export type LabelSource = 'auto' | 'user';

export interface TreeStream {
  id: string;
  slug: string;
  name: string;
  labelSource: LabelSource;
  position: number;
  reportCount: number;
  lastReportAt: string | null;
}

export interface TreeCategory {
  id: string;
  slug: string;
  name: string;
  labelSource: LabelSource;
  position: number;
  streams: TreeStream[];
}

export interface Tree {
  categories: TreeCategory[];
}

/** Response of the destination-scoped agent-instructions endpoints. */
export interface AgentInstructions {
  registrationToken: string;
  setupPrompt: string;
  schema: unknown;
  baseUrlNote?: string;
}

// --- Dashboards & widgets (Phase 9) -------------------------------------

/** Column span on the 12-column responsive grid (full / half / third). */
export type WidgetSpan = 'full' | 'half' | 'third';
/** Time window shared by chart / report_count widgets. */
export type WidgetRange = '24h' | '7d' | '30d';
/** Bucket granularity for the report_count widget. */
export type CountBucket = 'day' | 'hour';
/** Chart rendering variant (reuses the Phase 8 chart renderer's variants). */
export type ChartVariant = 'line' | 'bar' | 'area';
/** report_count target scope. */
export type CountScope = 'stream' | 'category';
/** The five widget types the grid builder supports. */
export type WidgetType = 'stream_feed' | 'metric' | 'chart' | 'report_count' | 'alert_feed';

export interface StreamFeedConfig {
  streamId: string;
  limit: number;
}
export interface MetricConfig {
  streamId: string;
  metricKey: string;
  label?: string;
}
export interface ChartConfig {
  streamId: string;
  metricKey: string;
  variant: ChartVariant;
  range?: WidgetRange;
}
export interface ReportCountConfig {
  scope: CountScope;
  targetId: string;
  bucket?: CountBucket;
  range?: WidgetRange;
}
export interface AlertFeedConfig {
  categoryId: string;
  limit: number;
}

interface WidgetBase {
  id: string;
  span: WidgetSpan;
  row: number;
}

/** A single dashboard widget — discriminated on `type` (mirrors the API layout schema). */
export type DashboardWidget =
  | (WidgetBase & { type: 'stream_feed'; config: StreamFeedConfig })
  | (WidgetBase & { type: 'metric'; config: MetricConfig })
  | (WidgetBase & { type: 'chart'; config: ChartConfig })
  | (WidgetBase & { type: 'report_count'; config: ReportCountConfig })
  | (WidgetBase & { type: 'alert_feed'; config: AlertFeedConfig });

/** The versioned layout envelope persisted in `dashboards.layout`. */
export interface DashboardLayout {
  version: 1;
  widgets: DashboardWidget[];
}

/** Lightweight sidebar/listing shape (no layout). */
export interface DashboardListItem {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  position: number;
  isDefault: boolean;
}

/** `GET /dashboards` — list + default marker + Overview-fallback flag. */
export interface DashboardListResult {
  dashboards: DashboardListItem[];
  defaultDashboardId: string | null;
  isOverviewFallback: boolean;
}

/** Full dashboard incl. the normalized layout. */
export interface DashboardFull extends DashboardListItem {
  workspaceId: string;
  layout: DashboardLayout;
  createdAt: string;
}

/** One metric sample. */
export interface MetricPoint {
  value: number;
  occurredAt: string;
}

/** metric widget — latest value (+ previous + delta). */
export interface MetricLatest {
  streamId: string;
  metricKey: string;
  latest: MetricPoint | null;
  previous: MetricPoint | null;
  delta: number | null;
}

/** chart widget — a metric time-series. */
export interface MetricSeries {
  streamId: string;
  metricKey: string;
  range: WidgetRange;
  points: MetricPoint[];
  truncated: boolean;
}

/** report_count widget — one time bucket of report volume. */
export interface CountBucketRow {
  bucket: string;
  count: number;
}

export interface ReportCountResult {
  scope: CountScope;
  targetId: string;
  bucket: CountBucket;
  range: WidgetRange;
  buckets: CountBucketRow[];
}

/** alert_feed widget — a compact report summary. */
export interface AlertItem {
  id: string;
  title: string;
  summary: string | null;
  severity: Severity | null;
  occurredAt: string;
  receivedAt: string;
  tags: string[];
  stream: StreamRef;
}

/** Filters that drive the report list query (also serialized into the URL). */
export interface ReportFilters {
  q?: string;
  category?: string;
  stream?: string;
  source?: string;
  severity?: Severity;
  tags?: string[];
  from?: string;
  to?: string;
}
