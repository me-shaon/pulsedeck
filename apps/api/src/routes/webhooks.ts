import { severitySchema } from '@pulsedeck/schema';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { makeRequireAuth, makeRequireWorkspaceRole } from '../auth/fastify.js';
import { LimitExceededError } from '../services/limits.js';
import {
  createWebhookWithinLimit,
  deleteWebhook,
  enqueueTestDelivery,
  getWebhook,
  listDeliveries,
  listWebhooks,
  redeliver,
  rotateSecret,
  updateWebhook,
} from '../services/webhooks.js';
import { assertUrlAllowed, WebhookUrlError } from '../webhooks/ssrf.js';

/**
 * Outbound webhook management (PRD "Webhooks"). All endpoints are
 * workspace-scoped and gated by `webhooks:manage` (owner/admin). The signing
 * secret is returned ONCE — by create and rotate-secret — and never by a read.
 *
 * URL safety is enforced here (create + update) against the deployment's SSRF
 * policy; the runner re-checks before each send. The cache that the ingestion
 * fan-out reads is invalidated on every mutation so a change takes effect at
 * once instead of waiting out the TTL.
 */

const formatSchema = z.enum(['generic', 'slack', 'discord', 'mattermost']);

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  url: z.string().min(1).max(2048),
  format: formatSchema.default('generic'),
  severities: z.array(severitySchema).max(3).default([]),
  categoryIds: z.array(z.string().min(1)).max(500).default([]),
  enabled: z.boolean().default(true),
});

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  url: z.string().min(1).max(2048).optional(),
  format: formatSchema.optional(),
  severities: z.array(severitySchema).max(3).optional(),
  categoryIds: z.array(z.string().min(1)).max(500).optional(),
  enabled: z.boolean().optional(),
});

const DeliveriesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const requireAuth = makeRequireAuth(app.auth);
  const manage = [requireAuth, makeRequireWorkspaceRole(db, 'webhooks:manage')];

  const allowPrivateIps = app.runtime.webhook.allowPrivateIps;
  const maxAttempts = app.runtime.webhook.maxAttempts;
  const appBaseUrl = app.authEnv.BETTER_AUTH_URL;

  // --- Create ---------------------------------------------------------------
  app.post('/api/v1/workspaces/:id/webhooks', { preHandler: manage }, async (req, reply) => {
    const { id: workspaceId } = req.params as { id: string };
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
    }
    let row;
    try {
      await assertUrlAllowed(parsed.data.url, allowPrivateIps);
      // Quota check + insert are serialized under a per-account advisory lock so
      // concurrent creates can't overshoot maxWebhooks (see createWebhookWithinLimit).
      row = await createWebhookWithinLimit(db, workspaceId, parsed.data);
    } catch (err) {
      return sendDomainError(reply, err);
    }
    app.webhookEnqueuer.invalidate(workspaceId);
    // The full row (incl. `secret`) is returned ONLY here.
    return reply.code(201).send({ webhook: row });
  });

  // --- List -----------------------------------------------------------------
  app.get('/api/v1/workspaces/:id/webhooks', { preHandler: manage }, async (req, reply) => {
    const { id: workspaceId } = req.params as { id: string };
    return reply.send({ webhooks: await listWebhooks(db, workspaceId) });
  });

  // --- Detail ---------------------------------------------------------------
  app.get('/api/v1/workspaces/:id/webhooks/:whId', { preHandler: manage }, async (req, reply) => {
    const { id: workspaceId, whId } = req.params as { id: string; whId: string };
    const webhook = await getWebhook(db, workspaceId, whId);
    if (!webhook) return reply.code(404).send({ error: 'Webhook not found' });
    return reply.send({ webhook });
  });

  // --- Update ---------------------------------------------------------------
  app.patch('/api/v1/workspaces/:id/webhooks/:whId', { preHandler: manage }, async (req, reply) => {
    const { id: workspaceId, whId } = req.params as { id: string; whId: string };
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
    }
    if (parsed.data.url !== undefined) {
      try {
        await assertUrlAllowed(parsed.data.url, allowPrivateIps);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    }
    const webhook = await updateWebhook(db, workspaceId, whId, parsed.data);
    if (!webhook) return reply.code(404).send({ error: 'Webhook not found' });
    app.webhookEnqueuer.invalidate(workspaceId);
    return reply.send({ webhook });
  });

  // --- Rotate secret --------------------------------------------------------
  app.post(
    '/api/v1/workspaces/:id/webhooks/:whId/rotate-secret',
    { preHandler: manage },
    async (req, reply) => {
      const { id: workspaceId, whId } = req.params as { id: string; whId: string };
      const secret = await rotateSecret(db, workspaceId, whId);
      if (!secret) return reply.code(404).send({ error: 'Webhook not found' });
      app.webhookEnqueuer.invalidate(workspaceId);
      return reply.send({ secret });
    },
  );

  // --- Delete ---------------------------------------------------------------
  app.delete(
    '/api/v1/workspaces/:id/webhooks/:whId',
    { preHandler: manage },
    async (req, reply) => {
      const { id: workspaceId, whId } = req.params as { id: string; whId: string };
      const ok = await deleteWebhook(db, workspaceId, whId);
      if (!ok) return reply.code(404).send({ error: 'Webhook not found' });
      app.webhookEnqueuer.invalidate(workspaceId);
      return reply.code(204).send();
    },
  );

  // --- Test delivery --------------------------------------------------------
  app.post(
    '/api/v1/workspaces/:id/webhooks/:whId/test',
    { preHandler: manage },
    async (req, reply) => {
      const { id: workspaceId, whId } = req.params as { id: string; whId: string };
      const deliveryId = await enqueueTestDelivery(db, workspaceId, whId, {
        appBaseUrl,
        maxAttempts,
      });
      if (!deliveryId) return reply.code(404).send({ error: 'Webhook not found' });
      return reply.code(202).send({ deliveryId });
    },
  );

  // --- Delivery log ---------------------------------------------------------
  app.get(
    '/api/v1/workspaces/:id/webhooks/:whId/deliveries',
    { preHandler: manage },
    async (req, reply) => {
      const { id: workspaceId, whId } = req.params as { id: string; whId: string };
      const parsed = DeliveriesQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid query', issues: parsed.error.issues });
      }
      const page = await listDeliveries(db, workspaceId, whId, parsed.data);
      if (!page) return reply.code(404).send({ error: 'Webhook not found' });
      return reply.send(page);
    },
  );

  // --- Redeliver one logged delivery ----------------------------------------
  app.post(
    '/api/v1/workspaces/:id/webhooks/:whId/deliveries/:deliveryId/redeliver',
    { preHandler: manage },
    async (req, reply) => {
      const { id: workspaceId, deliveryId } = req.params as {
        id: string;
        deliveryId: string;
      };
      const ok = await redeliver(db, workspaceId, deliveryId);
      if (!ok) return reply.code(404).send({ error: 'Delivery not found or not retryable' });
      return reply.code(202).send({ deliveryId });
    },
  );
}

/** Map a webhook domain error to its HTTP response; rethrow anything else. */
function sendDomainError(reply: FastifyReply, err: unknown) {
  if (err instanceof WebhookUrlError) {
    return reply.code(err.statusCode).send({ error: 'invalid_url', message: err.message });
  }
  if (err instanceof LimitExceededError) {
    return reply
      .code(err.statusCode)
      .send({ error: 'limit_exceeded', limit: err.limit, message: err.message });
  }
  throw err;
}
