import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { makeRequireAuth, makeRequireWorkspaceRole } from '../auth/fastify.js';
import type { ReportLifecycleKind } from '../events/ingestion.js';
import {
  archiveReports,
  deleteReports,
  unarchiveReports,
  type ReportMutationResult,
} from '../services/reports-mutations.js';

/**
 * Write-side report endpoints: bulk archive, unarchive, and hard-delete (the
 * archive feature). Reports are otherwise append-only (created only by agent
 * ingestion), so these are the only per-report mutations.
 *
 *   POST /api/v1/workspaces/:id/reports/bulk/archive
 *   POST /api/v1/workspaces/:id/reports/bulk/unarchive
 *   POST /api/v1/workspaces/:id/reports/bulk/delete
 *
 * All three are gated by `reports:manage` (owner/admin/editor — Viewer denied),
 * take `{ ids: string[] }`, and respond `{ affected }`. The service scopes every
 * statement by workspace, so foreign ids are silently no-ops. On a real change,
 * a realtime lifecycle event is emitted per touched stream so other open feeds
 * invalidate without a refresh.
 */

// Cap matches the existing reorder bound — bulk, but not unbounded.
const BulkBody = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

export async function reportsWriteRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const requireAuth = makeRequireAuth(app.auth);
  const manageReports = [requireAuth, makeRequireWorkspaceRole(db, 'reports:manage')];

  /** Emit one lifecycle event per touched stream so SSE clients invalidate. */
  function emit(kind: ReportLifecycleKind, workspaceId: string, res: ReportMutationResult): void {
    for (const streamId of res.streamIds) {
      app.ingestionBus.emitReportLifecycle({
        kind,
        workspaceId,
        streamId,
        reportIds: res.reportIds,
      });
    }
  }

  function register(
    path: string,
    kind: ReportLifecycleKind,
    run: (workspaceId: string, ids: string[]) => Promise<ReportMutationResult>,
  ): void {
    app.post(path, { preHandler: manageReports }, async (req, reply) => {
      const { id: workspaceId } = req.params as { id: string };
      const parsed = BulkBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
      }
      const res = await run(workspaceId, parsed.data.ids);
      if (res.affected > 0) emit(kind, workspaceId, res);
      return reply.send({ affected: res.affected });
    });
  }

  register('/api/v1/workspaces/:id/reports/bulk/archive', 'archived', (ws, ids) =>
    archiveReports(db, ws, ids),
  );
  register('/api/v1/workspaces/:id/reports/bulk/unarchive', 'unarchived', (ws, ids) =>
    unarchiveReports(db, ws, ids),
  );
  register('/api/v1/workspaces/:id/reports/bulk/delete', 'deleted', (ws, ids) =>
    deleteReports(db, ws, ids),
  );
}
