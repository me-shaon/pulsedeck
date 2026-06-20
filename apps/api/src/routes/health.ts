import type { FastifyInstance } from 'fastify';
import { pingDb } from '../db.js';

/**
 * Health + ops observability (PRD "Self-Hosting" + "Report Retention").
 *
 *   GET /healthz            — liveness + DB reachability (the orchestrator probe).
 *   GET /healthz/retention  — retention sweep last-run status.
 *
 * Both are unauthenticated liveness/ops signals. `/healthz` keeps its exact
 * 200/503 contract; the retention status lives at its own path so a strict probe
 * on `/healthz` is unaffected and the (non-sensitive) sweep status is still
 * readable without auth.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async (_request, reply) => {
    const up = await pingDb(app.sql);
    if (!up) {
      app.log.warn('healthz: database ping failed');
    }
    return reply
      .status(up ? 200 : 503)
      .send({ status: up ? 'ok' : 'degraded', db: up ? 'up' : 'down' });
  });

  // Retention observability: when it last ran, how many rows it purged, the
  // outcome, and whether retention is enabled. Always 200 — it reports the
  // sweep's health, it isn't itself a liveness gate. No sensitive data.
  app.get('/healthz/retention', async (_request, reply) => {
    return reply.status(200).send(app.retention.getStatus());
  });
}
