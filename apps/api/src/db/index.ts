import { drizzle } from 'drizzle-orm/postgres-js';
import type { Sql } from '../db.js';
import * as schema from './schema/index.js';

/**
 * Wrap a postgres-js client (`Sql` from `src/db.ts`) with Drizzle, registering
 * the full schema so routes get a typed query builder and `db.query.*`
 * relational queries. Existing routes are untouched; this is the helper they
 * opt into in later phases.
 */
export function createDrizzle(sql: Sql) {
  return drizzle(sql, { schema });
}

/** Typed Drizzle database instance for PulseDeck. */
export type Db = ReturnType<typeof createDrizzle>;

export { schema };
export * from './schema/index.js';
export * from './id.js';
