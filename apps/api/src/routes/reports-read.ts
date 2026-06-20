import type { FastifyInstance } from 'fastify';
import { makeRequireAuth, makeRequireWorkspaceRole } from '../auth/fastify.js';
import {
  getReportDetail,
  getTree,
  listReports,
  parseListQuery,
  streamInWorkspace,
} from '../services/reports-query.js';

/**
 * Read APIs for the dashboard (PRD "Report List & Detail", "Categories &
 * Streams", "Search", "Sidebar"). All endpoints are workspace-scoped and gated
 * by `reports:view`, which every role (owner/admin/editor/viewer) holds — so any
 * member reads and a non-member 404s at the preHandler (existence hidden).
 *
 * The query/pagination/cursor/full-text logic lives in
 * `services/reports-query.ts`; these handlers only parse params, enforce the
 * stream/report workspace boundary, and map results to a response.
 *
 *   GET /api/v1/workspaces/:id/reports                       → list (All Reports)
 *   GET /api/v1/workspaces/:id/streams/:streamId/reports     → stream feed
 *   GET /api/v1/workspaces/:id/reports/:reportId             → detail + prev/next
 *   GET /api/v1/workspaces/:id/tree                          → category→stream tree
 */
export async function reportReadRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const requireAuth = makeRequireAuth(app.auth);
  const viewGate = [requireAuth, makeRequireWorkspaceRole(db, 'reports:view')];

  // --- Workspace-wide "All Reports" list ------------------------------------
  app.get('/api/v1/workspaces/:id/reports', { preHandler: viewGate }, async (request, reply) => {
    const { id: workspaceId } = request.params as { id: string };
    const parsed = parseListQuery(request.query as Record<string, unknown>);
    if (!parsed.ok) {
      return reply.code(400).send({ error: 'invalid_query', message: parsed.message });
    }
    const result = await listReports(db, { workspaceId, params: parsed.value });
    return reply.send(result);
  });

  // --- Stream feed (same shape/pagination/filters, scoped to one stream) -----
  app.get(
    '/api/v1/workspaces/:id/streams/:streamId/reports',
    { preHandler: viewGate },
    async (request, reply) => {
      const { id: workspaceId, streamId } = request.params as {
        id: string;
        streamId: string;
      };
      // The stream must belong to this workspace, else 404 (no cross-workspace
      // addressing). Done before parsing so a foreign stream never leaks.
      if (!(await streamInWorkspace(db, workspaceId, streamId))) {
        return reply.code(404).send({ error: 'Stream not found' });
      }
      const parsed = parseListQuery(request.query as Record<string, unknown>);
      if (!parsed.ok) {
        return reply.code(400).send({ error: 'invalid_query', message: parsed.message });
      }
      const result = await listReports(db, { workspaceId, streamId, params: parsed.value });
      return reply.send(result);
    },
  );

  // --- Report detail (full blocks + metadata + permalink prev/next) ----------
  app.get(
    '/api/v1/workspaces/:id/reports/:reportId',
    { preHandler: viewGate },
    async (request, reply) => {
      const { id: workspaceId, reportId } = request.params as {
        id: string;
        reportId: string;
      };
      const detail = await getReportDetail(db, { workspaceId, reportId });
      if (!detail) return reply.code(404).send({ error: 'Report not found' });
      return reply.send(detail);
    },
  );

  // --- Auto-generated category→stream navigation tree (sidebar) --------------
  app.get('/api/v1/workspaces/:id/tree', { preHandler: viewGate }, async (request, reply) => {
    const { id: workspaceId } = request.params as { id: string };
    const categories = await getTree(db, workspaceId);
    return reply.send({ categories });
  });
}
