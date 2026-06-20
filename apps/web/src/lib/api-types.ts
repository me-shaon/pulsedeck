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

export interface AuthConfig {
  githubEnabled: boolean;
  setupRequired: boolean;
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

export interface TreeStream {
  id: string;
  slug: string;
  name: string;
  position: number;
  reportCount: number;
  lastReportAt: string | null;
}

export interface TreeCategory {
  id: string;
  slug: string;
  name: string;
  position: number;
  streams: TreeStream[];
}

export interface Tree {
  categories: TreeCategory[];
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
