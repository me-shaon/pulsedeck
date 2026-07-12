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

/** A Drizzle transaction handle (the argument to `db.transaction`). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * A query executor: either the pooled `Db` or an open transaction `Tx`. Read
 * helpers accept this so the same count/limit logic runs both standalone and
 * inside a quota-enforcing transaction.
 */
export type DbOrTx = Db | Tx;

export { schema };
export * from './schema/index.js';
export * from './id.js';
