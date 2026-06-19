import { customType, timestamp } from 'drizzle-orm/pg-core';

/**
 * Shared column helpers and custom types used across the schema.
 */

/**
 * Postgres `tsvector` column type. Drizzle pg-core has no native builder, so we
 * register one here. Used for `reports.search_vector`, a plain (non-generated)
 * column populated at ingest and backed by a GIN index, powering full-text
 * search (PRD "Search").
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * UTC `timestamptz` column with no default (the value is supplied explicitly).
 * Centralizes the timezone/mode convention so it lives in exactly one place.
 */
export const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Server-side timestamp (UTC, `timestamptz`) defaulting to `now()`. PulseDeck
 * stores everything in UTC and renders per-user timezones in the client.
 */
export const serverTimestamp = (name: string) => utcTimestamp(name).notNull().defaultNow();
