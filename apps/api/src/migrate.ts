import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Sql } from './db.js';

// Drizzle migrations live alongside the API; drizzle-kit will generate SQL
// files here in Phase 2. Resolves correctly from both src (tsx) and dist.
const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Apply any pending migrations before the server starts listening.
 *
 * Phase 0 has no migrations yet, so this no-ops gracefully when the folder is
 * missing or contains no generated SQL. Phase 2 just drops files in.
 */
export async function runMigrations(
  sql: Sql,
  migrationsFolder: string = DEFAULT_MIGRATIONS_DIR,
): Promise<void> {
  if (!existsSync(migrationsFolder)) return;

  const hasMigrations = readdirSync(migrationsFolder).some((file) => file.endsWith('.sql'));
  if (!hasMigrations) return;

  const db = drizzle(sql);
  await migrate(db, { migrationsFolder });
}
