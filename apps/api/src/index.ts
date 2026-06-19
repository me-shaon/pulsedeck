import { createDb } from './db.js';
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

  const app = buildServer({ sql, logger: true });
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
