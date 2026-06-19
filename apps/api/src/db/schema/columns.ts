import { customType, timestamp } from 'drizzle-orm/pg-core';

/**
 * Shared column helpers and custom types used across the schema.
 */

/**
 * Postgres `tsvector` column type. Drizzle pg-core has no native builder, so we
 * register one here. Used for `reports.search_vector`, a generated column with
 * a GIN index that powers full-text search (PRD "Search").
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * Server-side timestamp (UTC, `timestamptz`) defaulting to `now()`. PulseDeck
 * stores everything in UTC and renders per-user timezones in the client.
 */
export const serverTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();
