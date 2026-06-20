import { createAuth } from './auth/auth.js';
import { runBootstrap } from './auth/setup.js';
import { createDb } from './db.js';
import { createDrizzle } from './db/index.js';
import { loadEnv, type Env } from './env.js';
import { runMigrations } from './migrate.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  let env: Env;
  try {
    env = loadEnv();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

  const sql = createDb(env.DATABASE_URL);

  // Migrations must complete before we accept traffic.
  await runMigrations(sql);

  const db = createDrizzle(sql);
  const auth = createAuth(db, env);

  // Headless first-run: seed the admin + workspace when BOOTSTRAP_* is set and
  // there are zero users. Idempotent (no-op once any user exists).
  await runBootstrap(db, sql, auth, env);

  const app = buildServer({
    sql,
    logger: true,
    env,
    auth,
    redisUrl: env.REDIS_URL,
    sseEnabled: env.SSE_ENABLED,
    retentionDays: env.RETENTION_DAYS,
    retentionSweepIntervalMs: env.RETENTION_SWEEP_INTERVAL_MS,
  });
  // Connect the realtime Redis tier when REDIS_URL is set; a no-op otherwise.
  // start() never throws — a Redis failure logs and degrades to single-instance.
  await app.realtime.start();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  // Arm the retention sweep AFTER we're listening. No-op when RETENTION_DAYS=0;
  // otherwise the advisory lock keeps it single-run across replicas. The timer
  // is unref()'d, so it never blocks the graceful shutdown below.
  app.retention.start();

  // Close the server and drain the connection pool on container stop so
  // redeploys don't drop in-flight requests or leak connections.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
