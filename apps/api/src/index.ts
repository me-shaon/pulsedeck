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
  await runBootstrap(db, auth, env);

  const app = buildServer({ sql, logger: true, env, auth });
  await app.listen({ port: env.PORT, host: '0.0.0.0' });

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
