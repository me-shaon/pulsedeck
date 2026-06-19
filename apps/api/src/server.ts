import Fastify, { type FastifyInstance } from 'fastify';
import { createAuth, type Auth, type AuthEnv } from './auth/auth.js';
import { registerAuthHandler } from './auth/fastify.js';
import { createDrizzle, type Db } from './db/index.js';
import type { Sql } from './db.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { workspaceRoutes } from './routes/workspaces.js';

// Shared singletons are decorated onto the app so every route/plugin reads them
// off `app` instead of re-threading them through registration options.
declare module 'fastify' {
  interface FastifyInstance {
    sql: Sql;
    db: Db;
    auth: Auth;
    /** Auth-relevant env, exposed so `/auth/config` can report capabilities. */
    authEnv: AuthEnv;
  }
}

export interface BuildServerOptions {
  sql: Sql;
  logger?: boolean;
  /** Auth-relevant environment (secret, GitHub creds, base URL). */
  env?: AuthEnv;
  /** Pre-built Drizzle db; defaults to `createDrizzle(sql)`. Injectable so a
   * DB-less test (e.g. health) can pass a stub without constructing a driver. */
  db?: Db;
  /** Pre-built better-auth instance; defaults to `createAuth(db, env)`. */
  auth?: Auth;
}

/**
 * Compose the Fastify app from its route modules. `sql` is dependency-injected
 * so tests can pass a stub; the Drizzle `db` and better-auth `auth` are derived
 * from it (or injected) and decorated for the route modules to consume.
 */
export function buildServer({
  sql,
  logger = false,
  env = {},
  db,
  auth,
}: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger });

  const dbInstance = db ?? createDrizzle(sql);
  const authInstance = auth ?? createAuth(dbInstance, env);

  app.decorate('sql', sql);
  app.decorate('db', dbInstance);
  app.decorate('auth', authInstance);
  app.decorate('authEnv', env);

  // Default request decorations the auth preHandlers populate.
  app.decorateRequest('user', null);
  app.decorateRequest('workspaceRole', null);

  // better-auth's own endpoints (sign-in/up, OAuth callbacks, sign-out, …).
  registerAuthHandler(app, authInstance);

  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(workspaceRoutes);

  return app;
}
