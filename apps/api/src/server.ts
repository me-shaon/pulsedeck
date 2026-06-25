import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { createAuth, type Auth, type AuthEnv } from './auth/auth.js';
import { registerAuthHandler } from './auth/fastify.js';
import { buildRuntimeConfig, type RuntimeConfig } from './config/runtime.js';
import { createDrizzle, type Db } from './db/index.js';
import type { Sql } from './db.js';
import { ingestionBus } from './events/ingestion.js';
import { createRealtime, type Realtime } from './events/realtime.js';
import { authRoutes } from './routes/auth.js';
import { dashboardRoutes } from './routes/dashboards.js';
import { eventRoutes } from './routes/events.js';
import { healthRoutes } from './routes/health.js';
import { reportReadRoutes } from './routes/reports-read.js';
import { reportsWriteRoutes } from './routes/reports-write.js';
import { reportRoutes } from './routes/reports.js';
import { sourceRoutes } from './routes/sources.js';
import { structureRoutes } from './routes/structure.js';
import { webhookRoutes } from './routes/webhooks.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { createRetentionRunner, type RetentionRunner } from './retention/index.js';
import { createConsoleEmailPort, type EmailPort } from './services/email.js';
import {
  createEnqueuer,
  createWebhookRunner,
  type Enqueuer,
  type WebhookRunner,
} from './webhooks/index.js';

// Shared singletons are decorated onto the app so every route/plugin reads them
// off `app` instead of re-threading them through registration options.
declare module 'fastify' {
  interface FastifyInstance {
    sql: Sql;
    db: Db;
    auth: Auth;
    /** Auth-relevant env, exposed so `/auth/config` can report capabilities. */
    authEnv: AuthEnv;
    /** Deployment runtime config (mode, signup, billing); drives capabilities. */
    runtime: RuntimeConfig;
    /** Transactional email port; console no-op in OSS, real provider in cloud. */
    email: EmailPort;
    /** Retention sweep runner; `start()`ed in index.ts, status read by /healthz. */
    retention: RetentionRunner;
    /** Ingestion→webhook fan-out; routes call `invalidate()` on webhook CRUD. */
    webhookEnqueuer: Enqueuer;
    /** Webhook delivery poller; `start()`ed in index.ts. */
    webhookRunner: WebhookRunner;
    /** Shared rate-limit store across replicas; null = in-memory (single node). */
    rateLimitRedis: Redis | null;
  }
}

/**
 * Sensitive better-auth endpoints worth throttling against brute force /
 * credential stuffing. High-frequency, non-guessable paths (get-session,
 * sign-out, OAuth callbacks) are intentionally excluded so normal app traffic
 * isn't rate limited.
 */
const SENSITIVE_AUTH_PATH =
  /^\/api\/auth\/(sign-in|sign-up|forget-password|reset-password|request-password-reset|change-password|change-email|two-factor)/;

function isSensitiveAuthPath(url: string): boolean {
  return SENSITIVE_AUTH_PATH.test(url.split('?')[0]);
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
  /** Enables the multi-instance (Redis) SSE tier when set. Unset → in-process. */
  redisUrl?: string;
  /** SSE endpoint master switch (env `SSE_ENABLED`). Defaults to enabled. */
  sseEnabled?: boolean;
  /** Pre-built realtime layer; defaults to `createRealtime({ bus, redisUrl })`.
   * Injectable so tests can supply a fake or a Redis-backed instance. */
  realtime?: Realtime;
  /** Deployment runtime config; defaults to self-host (`buildRuntimeConfig({})`). */
  runtime?: RuntimeConfig;
  /** Transactional email port; defaults to the console no-op (OSS). Injectable
   * so the cloud package can bind a real provider and tests can assert sends. */
  email?: EmailPort;
  /** Retention window in days (env `RETENTION_DAYS`). 0/omitted → disabled. */
  retentionDays?: number;
  /** Retention sweep cadence in ms (env `RETENTION_SWEEP_INTERVAL_MS`). */
  retentionSweepIntervalMs?: number;
  /** Pre-built retention runner; defaults to `createRetentionRunner(...)`.
   * Injectable so tests can supply a fake. NOT auto-started by buildServer. */
  retention?: RetentionRunner;
  /** Pre-built webhook delivery runner; defaults to `createWebhookRunner(...)`.
   * Injectable so tests can supply a fake. NOT auto-started by buildServer. */
  webhookRunner?: WebhookRunner;
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
  redisUrl,
  sseEnabled = true,
  realtime,
  runtime = buildRuntimeConfig({}),
  email,
  retentionDays = 0,
  retentionSweepIntervalMs = 3_600_000,
  retention,
  webhookRunner,
}: BuildServerOptions): FastifyInstance {
  // `trustProxy` so `request.ip` reflects the real client behind the reverse
  // proxy (nginx) — required for the IP-keyed auth/ingest rate limits to bucket
  // per client rather than lumping everyone under the proxy's address.
  const app = Fastify({ logger, trustProxy: runtime.trustProxy });

  const dbInstance = db ?? createDrizzle(sql);
  const authInstance = auth ?? createAuth(dbInstance, env);

  // Shared rate-limit store. With Redis the limits hold ACROSS replicas (and
  // survive restarts); without it each node counts independently in memory.
  let rateLimitRedis: Redis | null = null;
  if (redisUrl) {
    rateLimitRedis = new Redis(redisUrl, {
      // Keep request latency bounded if Redis is slow/down; combined with the
      // limiters' skipOnError (below) this fails OPEN rather than 500ing or
      // locking users out. Offline queue stays on (default) so commands issued
      // before the connection is ready buffer briefly instead of erroring.
      maxRetriesPerRequest: 1,
      connectionName: 'pulsedeck-ratelimit',
    });
    rateLimitRedis.on('error', (err: Error) => app.log.warn({ err }, 'rate-limit redis error'));
  }
  app.decorate('rateLimitRedis', rateLimitRedis);
  app.addHook('onClose', async () => {
    if (rateLimitRedis) await rateLimitRedis.quit().catch(() => {});
  });

  app.decorate('sql', sql);
  app.decorate('db', dbInstance);
  app.decorate('auth', authInstance);
  app.decorate('authEnv', env);
  app.decorate('runtime', runtime);
  // Transactional email. OSS default: the console no-op port (logs, sends
  // nothing) so a self-host deploy with no mail provider still works and invites
  // surface their URL in the API response. The cloud package injects a real one.
  app.decorate('email', email ?? createConsoleEmailPort({ info: (o, m) => app.log.info(o, m) }));
  // In-process ingestion event bus; the SSE/webhook fan-out attaches here later
  // and Phase 10 can swap the singleton for a Redis-backed bus transparently.
  app.decorate('ingestionBus', ingestionBus);

  // Realtime fan-out layer (PRD §7). Layers on top of the in-process bus and,
  // when `redisUrl` is set, fans events across replicas via Redis pub/sub. The
  // bus subscription is wired in the constructor, so single-instance SSE works
  // immediately; `start()` (called in index.ts) only connects Redis. Closed via
  // the onClose hook below so `app.close()` (tests + graceful shutdown) cleans up.
  const realtimeInstance =
    realtime ??
    createRealtime({
      bus: ingestionBus,
      redisUrl,
      logger: {
        info: (m) => app.log.info(m),
        warn: (m) => app.log.warn(m),
        error: (m, err) => app.log.error({ err }, m),
      },
    });
  app.decorate('realtime', realtimeInstance);
  app.decorate('sseEnabled', sseEnabled);
  app.addHook('onClose', async () => {
    await realtimeInstance.close();
  });

  // In-process retention sweep (PRD "Report Retention"). Created here so the
  // health route can read its status, but NOT started — index.ts calls
  // `app.retention.start()` after the server is listening. Disabled when
  // retentionDays is 0, so a default app (and every test) never schedules a
  // destructive job. Stopped on close so timers don't outlive the app.
  const retentionInstance =
    retention ??
    createRetentionRunner({
      db: dbInstance,
      sql,
      retentionDays,
      perAccountEnabled: runtime.perAccountRetention,
      sweepIntervalMs: retentionSweepIntervalMs,
      logger: {
        info: (o, m) => app.log.info(o, m),
        warn: (o, m) => app.log.warn(o, m),
        error: (o, m) => app.log.error(o, m),
      },
    });
  app.decorate('retention', retentionInstance);
  app.addHook('onClose', async () => {
    retentionInstance.stop();
  });

  // Outbound webhooks (PRD "Webhooks"). The enqueuer subscribes to the ingestion
  // bus and persists a delivery row per matching report (no HTTP); the runner
  // (created here, started in index.ts) claims and POSTs them. The bus
  // subscription is torn down on close so repeated buildServer() calls in tests
  // don't accumulate listeners on the singleton bus.
  const enqueuer = createEnqueuer({
    db: dbInstance,
    maxAttempts: runtime.webhook.maxAttempts,
    appBaseUrl: env.BETTER_AUTH_URL,
    logger: { warn: (o, m) => app.log.warn(o, m) },
  });
  app.decorate('webhookEnqueuer', enqueuer);
  const unsubWebhooks = ingestionBus.onReportIngested(enqueuer.onReportIngested);
  app.addHook('onClose', async () => {
    unsubWebhooks();
  });

  const webhookRunnerInstance =
    webhookRunner ??
    createWebhookRunner({
      db: dbInstance,
      pollIntervalMs: runtime.webhook.pollIntervalMs,
      batchSize: runtime.webhook.batchSize,
      deliveryTimeoutMs: runtime.webhook.deliveryTimeoutMs,
      allowPrivateIps: runtime.webhook.allowPrivateIps,
      logger: {
        info: (o, m) => app.log.info(o, m),
        warn: (o, m) => app.log.warn(o, m),
        error: (o, m) => app.log.error(o, m),
      },
    });
  app.decorate('webhookRunner', webhookRunnerInstance);
  app.addHook('onClose', async () => {
    webhookRunnerInstance.stop();
  });

  // Default request decorations the auth preHandlers populate.
  app.decorateRequest('user', null);
  app.decorateRequest('workspaceRole', null);
  // Populated by the source bearer-auth preHandler (`makeRequireSource`).
  app.decorateRequest('source', null);

  // Generic error handler: log the real error server-side, return an opaque
  // message so internal/driver/auth detail never leaks in the response body.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.status(status).send({ error: status >= 500 ? 'Internal Server Error' : error.message });
  });

  // better-auth's own endpoints (sign-in/up, OAuth callbacks, sign-out, …).
  // `runtime` lets the handler gate self-serve sign-up by signup mode. Mounted in
  // an encapsulated scope so the brute-force rate limiter applies ONLY here (and
  // only to the sensitive sub-paths, via allowList) — not to the rest of the API.
  app.register(async (authScope) => {
    await authScope.register(rateLimit, {
      max: runtime.auth.max,
      timeWindow: runtime.auth.timeWindow,
      nameSpace: 'pd-rl-auth:',
      ...(rateLimitRedis ? { redis: rateLimitRedis } : {}),
      // Fail open if the store errors — never 500 or lock out auth on a Redis blip.
      skipOnError: true,
      keyGenerator: (request) => request.ip,
      // Throttle only the brute-forceable paths; skip get-session/sign-out/OAuth.
      allowList: (request) => !isSensitiveAuthPath(request.url),
    });
    registerAuthHandler(authScope, authInstance, runtime);
  });

  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(workspaceRoutes);
  app.register(sourceRoutes);
  app.register(structureRoutes);
  app.register(reportRoutes);
  app.register(reportReadRoutes);
  app.register(reportsWriteRoutes);
  app.register(dashboardRoutes);
  app.register(eventRoutes);
  app.register(webhookRoutes);

  return app;
}
