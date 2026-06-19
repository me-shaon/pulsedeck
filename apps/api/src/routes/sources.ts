import { getSchemaInfo, SCHEMA_VERSION } from '@pulsedeck/schema';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { makeRequireAuth, makeRequireWorkspaceRole } from '../auth/fastify.js';
import { sources, type Source } from '../db/index.js';
import {
  buildSetupPrompt,
  createSource,
  listSources,
  registerSource,
  reissueRegistrationToken,
  revokeApiKey,
  rotateApiKey,
  updateSource,
} from '../services/sources.js';

/**
 * Source registration & management endpoints (PRD "Source Management" +
 * "Agent Integration Protocol").
 *
 * Three audiences:
 *   - Management routes under `/api/v1/workspaces/:id/sources*` — gated by
 *     `sources:manage` (Owner/Admin); the preHandler yields 401/404/403.
 *   - The registration handshake `POST /api/v1/sources/register` — PUBLIC (no
 *     session), authenticated solely by a one-time `X-Registration-Token`.
 *   - Schema discovery `GET /api/v1/schema` — PUBLIC, so agents can self-update.
 *
 * Raw `reg_`/`pd_` credentials are returned exactly once (create / re-issue /
 * rotate / register) and never persisted or logged in raw form.
 */

const scopeEnum = z.enum(['workspace', 'category', 'stream']);

const CreateSourceBody = z.object({
  name: z.string().min(1).max(120),
  scope: scopeEnum.optional(),
  allowStreamAutocreate: z.boolean().optional(),
  categoryIds: z.array(z.string().min(1)).max(200).optional(),
  streamIds: z.array(z.string().min(1)).max(200).optional(),
});

const UpdateSourceBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    scope: scopeEnum.optional(),
    allowStreamAutocreate: z.boolean().optional(),
    categoryIds: z.array(z.string().min(1)).max(200).optional(),
    streamIds: z.array(z.string().min(1)).max(200).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' });

const RegisterBody = z.object({
  name: z.string().min(1).max(120).optional(),
  agent_version: z.string().min(1).max(60).optional(),
});

/** Placeholder used when no BETTER_AUTH_URL is configured (e.g. local/dev). */
const BASE_URL_PLACEHOLDER = 'https://your-pulsedeck-host.example';

export async function sourceRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const requireAuth = makeRequireAuth(app.auth);
  const manage = [requireAuth, makeRequireWorkspaceRole(db, 'sources:manage')];

  /** Resolve BASE_URL for setup prompts; flag when a placeholder is substituted. */
  function resolveBaseUrl(): { baseUrl: string; isPlaceholder: boolean } {
    const configured = app.authEnv.BETTER_AUTH_URL;
    return configured
      ? { baseUrl: configured, isPlaceholder: false }
      : { baseUrl: BASE_URL_PLACEHOLDER, isPlaceholder: true };
  }

  /** Build the one-time setup payload returned on create / re-issue. */
  function setupPayload(regToken: string) {
    const { baseUrl, isPlaceholder } = resolveBaseUrl();
    const payload: {
      registrationToken: string;
      setupPrompt: string;
      schema: ReturnType<typeof getSchemaInfo>;
      baseUrlNote?: string;
    } = {
      registrationToken: regToken,
      setupPrompt: buildSetupPrompt(baseUrl, regToken),
      schema: getSchemaInfo(),
    };
    if (isPlaceholder) {
      payload.baseUrlNote =
        'BETTER_AUTH_URL is not configured; the setup prompt uses a placeholder base URL. Set BETTER_AUTH_URL and re-issue the token for a copy-paste-ready prompt.';
    }
    return payload;
  }

  /** Load a source ensuring it belongs to the workspace; null → 404 (hide cross-ws). */
  async function loadSource(workspaceId: string, sourceId: string): Promise<Source | null> {
    const [source] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)))
      .limit(1);
    return source ?? null;
  }

  // --- Schema discovery (PUBLIC) -------------------------------------------

  /** Current wire-contract version + descriptor, so agents can self-update. */
  app.get('/api/v1/schema', async (_request, reply) => {
    return reply.send({ version: SCHEMA_VERSION, schema: getSchemaInfo() });
  });

  // --- Registration handshake (PUBLIC, reg-token authenticated) -------------

  /**
   * Redeem a one-time registration token → mint the source's API key.
   * Auth is the `X-Registration-Token` header alone (no session). Status codes:
   *   - 400 missing header / malformed body
   *   - 401 unknown token
   *   - 410 expired token
   *   - 409 already-used token (incl. lost the single-use CAS race)
   *   - 200 success → { source_id, api_key, schema }
   */
  app.post('/api/v1/sources/register', async (request, reply) => {
    const rawToken = request.headers['x-registration-token'];
    const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
    if (!token) {
      return reply.code(400).send({ error: 'Missing X-Registration-Token header' });
    }

    const parsed = RegisterBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
    }

    const result = await registerSource(db, token, {
      name: parsed.data.name,
      agentVersion: parsed.data.agent_version,
    });

    if (!result.ok) {
      if (result.reason === 'unknown') {
        return reply.code(401).send({ error: 'Invalid registration token' });
      }
      if (result.reason === 'expired') {
        return reply.code(410).send({ error: 'Registration token expired' });
      }
      return reply.code(409).send({ error: 'Registration token already used' });
    }

    // Raw api_key returned exactly once; stored only as a hash.
    return reply.send({
      source_id: result.sourceId,
      api_key: result.apiKey,
      schema: result.schema,
    });
  });

  // --- Management (Owner/Admin: sources:manage) -----------------------------

  /** List connected agents/sources with health + report counts. */
  app.get('/api/v1/workspaces/:id/sources', { preHandler: manage }, async (request, reply) => {
    const { id: workspaceId } = request.params as { id: string };
    const items = await listSources(db, workspaceId);
    return reply.send({ sources: items });
  });

  /** Create a source + one-time registration token + copyable setup prompt. */
  app.post('/api/v1/workspaces/:id/sources', { preHandler: manage }, async (request, reply) => {
    const { id: workspaceId } = request.params as { id: string };
    const parsed = CreateSourceBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
    }

    const result = await createSource(db, {
      workspaceId,
      createdBy: request.user!.id,
      name: parsed.data.name,
      scope: parsed.data.scope,
      allowStreamAutocreate: parsed.data.allowStreamAutocreate,
      categoryIds: parsed.data.categoryIds,
      streamIds: parsed.data.streamIds,
    });
    if ('error' in result) {
      return reply.code(400).send({ error: result.error });
    }

    return reply.code(201).send({
      source: {
        id: result.source.id,
        name: result.source.name,
        scope: result.source.scope,
        allowStreamAutocreate: result.source.allowStreamAutocreate,
        createdAt: result.source.createdAt,
      },
      ...setupPayload(result.registrationToken),
    });
  });

  /** Re-issue a registration token (invalidates the prior unused one). */
  app.post(
    '/api/v1/workspaces/:id/sources/:sourceId/tokens',
    { preHandler: manage },
    async (request, reply) => {
      const { id: workspaceId, sourceId } = request.params as { id: string; sourceId: string };
      const source = await loadSource(workspaceId, sourceId);
      if (!source) return reply.code(404).send({ error: 'Source not found' });

      const regToken = await reissueRegistrationToken(db, sourceId, request.user!.id);
      return reply.code(201).send({
        source: { id: source.id, name: source.name },
        ...setupPayload(regToken),
      });
    },
  );

  /** Update scope / grants / name / autocreate. */
  app.patch(
    '/api/v1/workspaces/:id/sources/:sourceId',
    { preHandler: manage },
    async (request, reply) => {
      const { id: workspaceId, sourceId } = request.params as { id: string; sourceId: string };
      const parsed = UpdateSourceBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
      }
      const source = await loadSource(workspaceId, sourceId);
      if (!source) return reply.code(404).send({ error: 'Source not found' });

      const updated = await updateSource(db, workspaceId, source, parsed.data);
      if ('error' in updated) return reply.code(400).send({ error: updated.error });

      return reply.send({
        source: {
          id: updated.id,
          name: updated.name,
          scope: updated.scope,
          allowStreamAutocreate: updated.allowStreamAutocreate,
        },
      });
    },
  );

  /** Rotate the API key: new `pd_` key returned once; old key dies immediately. */
  app.post(
    '/api/v1/workspaces/:id/sources/:sourceId/rotate',
    { preHandler: manage },
    async (request, reply) => {
      const { id: workspaceId, sourceId } = request.params as { id: string; sourceId: string };
      const source = await loadSource(workspaceId, sourceId);
      if (!source) return reply.code(404).send({ error: 'Source not found' });

      const apiKey = await rotateApiKey(db, sourceId);
      return reply.send({ source_id: sourceId, api_key: apiKey });
    },
  );

  /** Revoke the API key (nulls the hash); source + history remain. */
  app.post(
    '/api/v1/workspaces/:id/sources/:sourceId/revoke',
    { preHandler: manage },
    async (request, reply) => {
      const { id: workspaceId, sourceId } = request.params as { id: string; sourceId: string };
      const source = await loadSource(workspaceId, sourceId);
      if (!source) return reply.code(404).send({ error: 'Source not found' });

      await revokeApiKey(db, sourceId);
      return reply.code(204).send();
    },
  );

  /**
   * Delete a source entirely. Cascades to its reports, scope grants, and
   * registration tokens (FK ON DELETE CASCADE). Destructive — prefer revoke to
   * preserve history.
   */
  app.delete(
    '/api/v1/workspaces/:id/sources/:sourceId',
    { preHandler: manage },
    async (request, reply) => {
      const { id: workspaceId, sourceId } = request.params as { id: string; sourceId: string };
      const source = await loadSource(workspaceId, sourceId);
      if (!source) return reply.code(404).send({ error: 'Source not found' });

      await db.delete(sources).where(eq(sources.id, sourceId)); // FKs cascade reports/grants/tokens
      return reply.code(204).send();
    },
  );
}
