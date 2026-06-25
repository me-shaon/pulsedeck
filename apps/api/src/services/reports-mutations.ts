import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { reports } from '../db/index.js';

/**
 * Write-side report mutations: archive, unarchive, and hard-delete (the archive
 * feature). Reports are otherwise append-only — these are the only operations
 * that change a report row after ingest.
 *
 * Every statement is scoped by `workspace_id` in addition to the supplied ids,
 * so a caller can never archive or delete a report outside its own workspace
 * even if it guesses foreign ids — the foreign rows simply don't match and are
 * reported as not-affected. The route layer (`reports:manage` gate) decides who
 * may call these; this layer enforces tenant isolation structurally.
 *
 * Each function returns the number of rows actually changed plus the distinct
 * streams touched, which the route uses to emit a realtime event per stream.
 */
export interface ReportMutationResult {
  /** Rows actually changed (excludes foreign ids and no-op transitions). */
  affected: number;
  /** Distinct streams that had at least one report changed. */
  streamIds: string[];
}

const EMPTY: ReportMutationResult = { affected: 0, streamIds: [] };

function summarize(rows: { streamId: string }[]): ReportMutationResult {
  return { affected: rows.length, streamIds: [...new Set(rows.map((r) => r.streamId))] };
}

/**
 * Archive reports: set `archived_at = now()` on the workspace's matching,
 * not-already-archived rows. Idempotent — re-archiving an archived report is a
 * no-op (the `isNull` guard excludes it), so `affected` reflects real changes.
 */
export async function archiveReports(
  db: Db,
  workspaceId: string,
  ids: string[],
): Promise<ReportMutationResult> {
  if (ids.length === 0) return EMPTY;
  const rows = await db
    .update(reports)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(reports.workspaceId, workspaceId),
        inArray(reports.id, ids),
        isNull(reports.archivedAt),
      ),
    )
    .returning({ streamId: reports.streamId });
  return summarize(rows);
}

/**
 * Unarchive reports: clear `archived_at` on the workspace's matching, currently
 * archived rows. Idempotent for already-active reports (excluded by `isNotNull`).
 */
export async function unarchiveReports(
  db: Db,
  workspaceId: string,
  ids: string[],
): Promise<ReportMutationResult> {
  if (ids.length === 0) return EMPTY;
  const rows = await db
    .update(reports)
    .set({ archivedAt: null })
    .where(
      and(
        eq(reports.workspaceId, workspaceId),
        inArray(reports.id, ids),
        isNotNull(reports.archivedAt),
      ),
    )
    .returning({ streamId: reports.streamId });
  return summarize(rows);
}

/**
 * Hard-delete reports: permanently remove the workspace's matching rows. No
 * soft-delete, no recovery. Reports own no child rows (`blocks` is JSONB,
 * `search_vector` a column), so there is nothing to cascade.
 */
export async function deleteReports(
  db: Db,
  workspaceId: string,
  ids: string[],
): Promise<ReportMutationResult> {
  if (ids.length === 0) return EMPTY;
  const rows = await db
    .delete(reports)
    .where(and(eq(reports.workspaceId, workspaceId), inArray(reports.id, ids)))
    .returning({ streamId: reports.streamId });
  return summarize(rows);
}
