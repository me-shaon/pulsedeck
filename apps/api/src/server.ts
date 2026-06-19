import Fastify, { type FastifyInstance } from 'fastify';
import type { Sql } from './db.js';
import { healthRoutes } from './routes/health.js';

// The database client is decorated onto the app so every route/plugin reads
// `app.sql` instead of re-threading it through registration options.
declare module 'fastify' {
  interface FastifyInstance {
    sql: Sql;
  }
}

export interface BuildServerOptions {
  sql: Sql;
  logger?: boolean;
}

/**
 * Compose the Fastify app from its route modules. The `sql` client is
 * dependency-injected so tests can pass a stub without a real database.
 */
export function buildServer({ sql, logger = false }: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger });
  app.decorate('sql', sql);
  app.register(healthRoutes);
  return app;
}
