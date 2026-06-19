import type { FastifyInstance } from 'fastify';
import { pingDb } from '../db.js';

/**
 * GET /healthz — liveness + DB reachability.
 * 200 `{ status: 'ok', db: 'up' }` when Postgres responds,
 * 503 `{ status: 'degraded', db: 'down' }` otherwise.
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
}
