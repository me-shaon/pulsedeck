import Fastify, { type FastifyInstance } from 'fastify';
import type { Sql } from './db.js';
import { healthRoutes } from './routes/health.js';

export interface BuildServerOptions {
  sql: Sql;
  logger?: boolean;
}

/**
 * Compose the Fastify app from its route modules. Kept dependency-injected so
 * tests can pass a stub `sql` client without a real database.
 */
export function buildServer({ sql, logger = false }: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger });
  app.register(healthRoutes, { sql });
  return app;
}
