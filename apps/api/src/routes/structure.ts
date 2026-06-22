import { getSchemaInfo } from '@pulsedeck/schema';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { makeRequireAuth, makeRequireWorkspaceRole } from '../auth/fastify.js';
import { categories, sources, streams, type Source } from '../db/index.js';
import {
  createCategory,
  createStream,
  deleteCategory,
  deleteStream,
  renameCategory,
  renameStream,
  reorderCategories,
  reorderStreams,
  type StructureError,
} from '../services/structure.js';
import { buildDestinationSetupPrompt, reissueRegistrationToken } from '../services/sources.js';

/**
 * Manual category/stream management + destination-scoped agent instructions
 * (companion to the auto-create path in `services/ingestion.ts`).
 *
 * RBAC reuses existing actions: category/stream CRUD + reorder need
 * `categories:create` / `streams:create` (owner/admin/editor); the
 * agent-instructions endpoints mint a registration token, so they require
 * `sources:manage` (owner/admin) — the same tier as source setup.
 *
 * NOTE: the literal `/reorder` routes are registered BEFORE the `/:categoryId`
 * and `/:streamId` param routes so Fastify matches the static segment first.
 */

const CreateCategoryBody = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80).optional(),
  position: z.number().int().min(0).optional(),
});
const RenameBody = z.object({ name: z.string().min(1).max(120) });
const ReorderBody = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });
const InstrQuery = z.object({ sourceId: z.string().min(1) });

const BASE_URL_PLACEHOLDER = 'https://your-pulsedeck-host.example';
const BASE_URL_NOTE =
  'BETTER_AUTH_URL is not configured; the prompt uses a placeholder base URL. Set it and re-generate the instructions.';

function statusForError(e: StructureError): number {
  if (e === 'slug_exists') return 409;
  if (e === 'not_found') return 404;
  return 400; // bad_order
}

export async function structureRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const requireAuth = makeRequireAuth(app.auth);
  const manageCategories = [requireAuth, makeRequireWorkspaceRole(db, 'categories:create')];
  const manageStreams = [requireAuth, makeRequireWorkspaceRole(db, 'streams:create')];
  const manageSources = [requireAuth, makeRequireWorkspaceRole(db, 'sources:manage')];

  function resolveBaseUrl(): { baseUrl: string; isPlaceholder: boolean } {
    const configured = app.authEnv.BETTER_AUTH_URL;
    return configured
      ? { baseUrl: configured, isPlaceholder: false }
      : { baseUrl: BASE_URL_PLACEHOLDER, isPlaceholder: true };
  }

  async function loadWsSource(workspaceId: string, sourceId: string): Promise<Source | null> {
    const [s] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)))
      .limit(1);
    return s ?? null;
  }

  // --- Categories -----------------------------------------------------------

  app.post(
    '/api/v1/workspaces/:id/categories',
    { preHandler: manageCategories },
    async (req, reply) => {
      const { id: workspaceId } = req.params as { id: string };
      const parsed = CreateCategoryBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
      }
      const res = await createCategory(db, { workspaceId, ...parsed.data });
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.code(201).send({ category: res.category });
    },
  );

  app.patch(
    '/api/v1/workspaces/:id/categories/reorder',
    { preHandler: manageCategories },
    async (req, reply) => {
      const { id: workspaceId } = req.params as { id: string };
      const parsed = ReorderBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
      const res = await reorderCategories(db, workspaceId, parsed.data.ids);
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.send({ ok: true });
    },
  );

  app.patch(
    '/api/v1/workspaces/:id/categories/:categoryId',
    { preHandler: manageCategories },
    async (req, reply) => {
      const { id: workspaceId, categoryId } = req.params as { id: string; categoryId: string };
      const parsed = RenameBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
      const res = await renameCategory(db, workspaceId, categoryId, parsed.data.name);
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.send({ category: res.category });
    },
  );

  app.delete(
    '/api/v1/workspaces/:id/categories/:categoryId',
    { preHandler: manageCategories },
    async (req, reply) => {
      const { id: workspaceId, categoryId } = req.params as { id: string; categoryId: string };
      const res = await deleteCategory(db, workspaceId, categoryId);
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.code(204).send();
    },
  );

  // --- Streams --------------------------------------------------------------

  app.post(
    '/api/v1/workspaces/:id/categories/:categoryId/streams',
    { preHandler: manageStreams },
    async (req, reply) => {
      const { id: workspaceId, categoryId } = req.params as { id: string; categoryId: string };
      const parsed = CreateCategoryBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
      }
      const res = await createStream(db, { workspaceId, categoryId, ...parsed.data });
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.code(201).send({ stream: res.stream });
    },
  );

  app.patch(
    '/api/v1/workspaces/:id/categories/:categoryId/streams/reorder',
    { preHandler: manageStreams },
    async (req, reply) => {
      const { id: workspaceId, categoryId } = req.params as { id: string; categoryId: string };
      const parsed = ReorderBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
      const res = await reorderStreams(db, workspaceId, categoryId, parsed.data.ids);
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.send({ ok: true });
    },
  );

  app.patch(
    '/api/v1/workspaces/:id/streams/:streamId',
    { preHandler: manageStreams },
    async (req, reply) => {
      const { id: workspaceId, streamId } = req.params as { id: string; streamId: string };
      const parsed = RenameBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
      const res = await renameStream(db, workspaceId, streamId, parsed.data.name);
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.send({ stream: res.stream });
    },
  );

  app.delete(
    '/api/v1/workspaces/:id/streams/:streamId',
    { preHandler: manageStreams },
    async (req, reply) => {
      const { id: workspaceId, streamId } = req.params as { id: string; streamId: string };
      const res = await deleteStream(db, workspaceId, streamId);
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.code(204).send();
    },
  );

  // --- Agent instructions (sources:manage — token-bearing) ------------------

  app.get(
    '/api/v1/workspaces/:id/streams/:streamId/agent-instructions',
    { preHandler: manageSources },
    async (req, reply) => {
      const { id: workspaceId, streamId } = req.params as { id: string; streamId: string };
      const q = InstrQuery.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: 'sourceId required' });
      const [row] = await db
        .select({ streamSlug: streams.slug, categorySlug: categories.slug })
        .from(streams)
        .innerJoin(categories, eq(categories.id, streams.categoryId))
        .where(and(eq(streams.id, streamId), eq(categories.workspaceId, workspaceId)))
        .limit(1);
      if (!row) return reply.code(404).send({ error: 'Stream not found' });
      const source = await loadWsSource(workspaceId, q.data.sourceId);
      if (!source) return reply.code(404).send({ error: 'Source not found' });

      const { baseUrl, isPlaceholder } = resolveBaseUrl();
      const regToken = await reissueRegistrationToken(db, source.id, req.user!.id);
      return reply.send({
        registrationToken: regToken,
        setupPrompt: buildDestinationSetupPrompt(baseUrl, regToken, {
          categorySlug: row.categorySlug,
          streamSlug: row.streamSlug,
        }),
        schema: getSchemaInfo(),
        ...(isPlaceholder ? { baseUrlNote: BASE_URL_NOTE } : {}),
      });
    },
  );

  app.get(
    '/api/v1/workspaces/:id/categories/:categoryId/agent-instructions',
    { preHandler: manageSources },
    async (req, reply) => {
      const { id: workspaceId, categoryId } = req.params as { id: string; categoryId: string };
      const q = InstrQuery.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: 'sourceId required' });
      const [cat] = await db
        .select({ slug: categories.slug })
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.workspaceId, workspaceId)))
        .limit(1);
      if (!cat) return reply.code(404).send({ error: 'Category not found' });
      const source = await loadWsSource(workspaceId, q.data.sourceId);
      if (!source) return reply.code(404).send({ error: 'Source not found' });

      const { baseUrl, isPlaceholder } = resolveBaseUrl();
      const regToken = await reissueRegistrationToken(db, source.id, req.user!.id);
      return reply.send({
        registrationToken: regToken,
        setupPrompt: buildDestinationSetupPrompt(baseUrl, regToken, { categorySlug: cat.slug }),
        schema: getSchemaInfo(),
        ...(isPlaceholder ? { baseUrlNote: BASE_URL_NOTE } : {}),
      });
    },
  );
}
