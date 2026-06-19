import type { FastifyInstance } from 'fastify';
import { pingDb, type Sql } from '../db.js';

export interface HealthRouteOptions {
  sql: Sql;
}

/**
 * GET /healthz — liveness + DB reachability.
 * 200 `{ status: 'ok', db: 'up' }` when Postgres responds,
 * 503 `{ status: 'degraded', db: 'down' }` otherwise.
 */
export async function healthRoutes(app: FastifyInstance, opts: HealthRouteOptions): Promise<void> {
  app.get('/healthz', async (_request, reply) => {
    const up = await pingDb(opts.sql);
    return reply
      .status(up ? 200 : 503)
      .send({ status: up ? 'ok' : 'degraded', db: up ? 'up' : 'down' });
  });
}
