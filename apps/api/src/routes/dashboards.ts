import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { makeRequireAuth, makeRequireWorkspaceRole } from '../auth/fastify.js';
import { dashboardLayoutSchema, emptyLayout } from '../dashboards/layout-schema.js';
import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  listDashboards,
  setDefaultDashboard,
  updateDashboard,
  validateLayoutReferences,
} from '../services/dashboards.js';
import {
  categoryInWorkspace,
  getAlertFeed,
  getMetricLatest,
  getMetricSeries,
  getReportCount,
  parseBucket,
  parseRange,
  streamInWorkspace,
  MAX_ALERT_FEED,
} from '../services/widgets.js';

/**
 * Dashboard CRUD + widget-data endpoints (PRD "Dashboards & Navigation"), all
 * under `/api/v1/workspaces/:id/...`.
 *
 * Gating: writes require `dashboards:build` (Owner/Admin/Editor); reads (the
 * list/get and every widget-data endpoint) require `reports:view` (any member).
 * The preHandler resolves membership → 401 unauth, 404 non-member, 403
 * insufficient role; handlers then enforce the per-resource workspace boundary
 * (foreign dashboard/stream/category → 404).
 *
 *   GET    /workspaces/:id/dashboards                       list + Overview marker
 *   POST   /workspaces/:id/dashboards                       create (first → default)
 *   GET    /workspaces/:id/dashboards/:dashId               full dashboard + layout
 *   PATCH  /workspaces/:id/dashboards/:dashId               update name/icon/layout/position
 *   POST   /workspaces/:id/dashboards/:dashId/default       set default (exactly one)
 *   DELETE /workspaces/:id/dashboards/:dashId               delete (promote a default)
 *
 *   GET /workspaces/:id/streams/:streamId/metrics/:key/latest    metric widget
 *   GET /workspaces/:id/streams/:streamId/metrics/:key/series    chart widget
 *   GET /workspaces/:id/reports/count                            report_count widget
 *   GET /workspaces/:id/categories/:categoryId/alerts            alert_feed widget
 *   (stream_feed reuses the Phase 6 stream list — no new endpoint)
 */

/** Layout is optional on create/update; when present it must be the strict shape. */
const CreateDashboardBody = z.object({
  name: z.string().min(1).max(120),
  icon: z.string().max(120).nullish(),
  layout: dashboardLayoutSchema.optional(),
});

const UpdateDashboardBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    icon: z.string().max(120).nullable().optional(),
    layout: dashboardLayoutSchema.optional(),
    position: z.number().int().min(0).max(9999).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'no fields to update' });

/** 422 with Zod issues — mirrors the ingestion validation-feedback contract. */
function unprocessable(reply: FastifyReply, issues: unknown) {
  return reply.code(422).send({ error: 'validation_failed', issues });
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const requireAuth = makeRequireAuth(app.auth);
  const buildGate = [requireAuth, makeRequireWorkspaceRole(db, 'dashboards:build')];
  const viewGate = [requireAuth, makeRequireWorkspaceRole(db, 'reports:view')];

  // --- Dashboard CRUD -------------------------------------------------------

  app.get('/api/v1/workspaces/:id/dashboards', { preHandler: viewGate }, async (request, reply) => {
    const { id: workspaceId } = request.params as { id: string };
    return reply.send(await listDashboards(db, workspaceId));
  });

  app.post(
    '/api/v1/workspaces/:id/dashboards',
    { preHandler: buildGate },
    async (request, reply) => {
      const { id: workspaceId } = request.params as { id: string };
      const parsed = CreateDashboardBody.safeParse(request.body);
      if (!parsed.success) return unprocessable(reply, parsed.error.issues);

      const layout = parsed.data.layout ?? emptyLayout();
      const invalid = await validateLayoutReferences(db, workspaceId, layout);
      if (invalid.length > 0) {
        return unprocessable(reply, [
          {
            path: ['layout'],
            message: `widget references not in this workspace: ${invalid.join(', ')}`,
          },
        ]);
      }

      const dashboard = await createDashboard(db, workspaceId, {
        name: parsed.data.name,
        icon: parsed.data.icon ?? null,
        layout,
      });
      return reply.code(201).send({ dashboard });
    },
  );

  app.get(
    '/api/v1/workspaces/:id/dashboards/:dashId',
    { preHandler: viewGate },
    async (request, reply) => {
      const { id: workspaceId, dashId } = request.params as { id: string; dashId: string };
      const dashboard = await getDashboard(db, workspaceId, dashId);
      if (!dashboard) return reply.code(404).send({ error: 'Dashboard not found' });
      return reply.send({ dashboard });
    },
  );

  app.patch(
    '/api/v1/workspaces/:id/dashboards/:dashId',
    { preHandler: buildGate },
    async (request, reply) => {
      const { id: workspaceId, dashId } = request.params as { id: string; dashId: string };
      const parsed = UpdateDashboardBody.safeParse(request.body);
      if (!parsed.success) return unprocessable(reply, parsed.error.issues);

      if (parsed.data.layout) {
        const invalid = await validateLayoutReferences(db, workspaceId, parsed.data.layout);
        if (invalid.length > 0) {
          return unprocessable(reply, [
            {
              path: ['layout'],
              message: `widget references not in this workspace: ${invalid.join(', ')}`,
            },
          ]);
        }
      }

      const dashboard = await updateDashboard(db, workspaceId, dashId, parsed.data);
      if (!dashboard) return reply.code(404).send({ error: 'Dashboard not found' });
      return reply.send({ dashboard });
    },
  );

  app.post(
    '/api/v1/workspaces/:id/dashboards/:dashId/default',
    { preHandler: buildGate },
    async (request, reply) => {
      const { id: workspaceId, dashId } = request.params as { id: string; dashId: string };
      const result = await setDefaultDashboard(db, workspaceId, dashId);
      if (result === 'not_found') return reply.code(404).send({ error: 'Dashboard not found' });
      const dashboard = await getDashboard(db, workspaceId, dashId);
      return reply.send({ dashboard });
    },
  );

  app.delete(
    '/api/v1/workspaces/:id/dashboards/:dashId',
    { preHandler: buildGate },
    async (request, reply) => {
      const { id: workspaceId, dashId } = request.params as { id: string; dashId: string };
      const result = await deleteDashboard(db, workspaceId, dashId);
      if (result === 'not_found') return reply.code(404).send({ error: 'Dashboard not found' });
      return reply.code(204).send();
    },
  );

  // --- Widget data ----------------------------------------------------------

  // metric widget — latest value (+ previous + delta) for a (stream, key).
  app.get(
    '/api/v1/workspaces/:id/streams/:streamId/metrics/:key/latest',
    { preHandler: viewGate },
    async (request, reply) => {
      const {
        id: workspaceId,
        streamId,
        key,
      } = request.params as {
        id: string;
        streamId: string;
        key: string;
      };
      if (!(await streamInWorkspace(db, workspaceId, streamId))) {
        return reply.code(404).send({ error: 'Stream not found' });
      }
      return reply.send(await getMetricLatest(db, streamId, key));
    },
  );

  // chart widget — time-series of a metric within a range.
  app.get(
    '/api/v1/workspaces/:id/streams/:streamId/metrics/:key/series',
    { preHandler: viewGate },
    async (request, reply) => {
      const {
        id: workspaceId,
        streamId,
        key,
      } = request.params as {
        id: string;
        streamId: string;
        key: string;
      };
      const range = parseRange((request.query as Record<string, unknown>).range);
      if (range === 'invalid') {
        return reply
          .code(400)
          .send({ error: 'invalid_query', message: 'range must be 24h|7d|30d' });
      }
      if (!(await streamInWorkspace(db, workspaceId, streamId))) {
        return reply.code(404).send({ error: 'Stream not found' });
      }
      return reply.send(await getMetricSeries(db, streamId, key, range));
    },
  );

  // report_count widget — time-bucketed report volume for a stream/category.
  app.get(
    '/api/v1/workspaces/:id/reports/count',
    { preHandler: viewGate },
    async (request, reply) => {
      const { id: workspaceId } = request.params as { id: string };
      const q = request.query as Record<string, unknown>;

      const scope = q.scope;
      if (scope !== 'stream' && scope !== 'category') {
        return reply
          .code(400)
          .send({ error: 'invalid_query', message: 'scope must be stream|category' });
      }
      const targetId = typeof q.targetId === 'string' ? q.targetId : undefined;
      if (!targetId) {
        return reply.code(400).send({ error: 'invalid_query', message: 'targetId is required' });
      }
      const bucket = parseBucket(q.bucket);
      if (bucket === 'invalid') {
        return reply.code(400).send({ error: 'invalid_query', message: 'bucket must be day|hour' });
      }
      const range = parseRange(q.range);
      if (range === 'invalid') {
        return reply
          .code(400)
          .send({ error: 'invalid_query', message: 'range must be 24h|7d|30d' });
      }

      const inWorkspace =
        scope === 'stream'
          ? await streamInWorkspace(db, workspaceId, targetId)
          : await categoryInWorkspace(db, workspaceId, targetId);
      if (!inWorkspace) return reply.code(404).send({ error: 'Target not found' });

      return reply.send(await getReportCount(db, { scope, targetId, bucket, range }));
    },
  );

  // alert_feed widget — recent warning|critical reports in a category.
  app.get(
    '/api/v1/workspaces/:id/categories/:categoryId/alerts',
    { preHandler: viewGate },
    async (request, reply) => {
      const { id: workspaceId, categoryId } = request.params as {
        id: string;
        categoryId: string;
      };
      const limitRaw = (request.query as Record<string, unknown>).limit;
      let limit = MAX_ALERT_FEED;
      if (limitRaw !== undefined) {
        const n = Number(limitRaw);
        if (!Number.isInteger(n) || n < 1 || n > MAX_ALERT_FEED) {
          return reply
            .code(400)
            .send({ error: 'invalid_query', message: `limit must be 1..${MAX_ALERT_FEED}` });
        }
        limit = n;
      }
      if (!(await categoryInWorkspace(db, workspaceId, categoryId))) {
        return reply.code(404).send({ error: 'Category not found' });
      }
      return reply.send({ alerts: await getAlertFeed(db, categoryId, limit) });
    },
  );
}
