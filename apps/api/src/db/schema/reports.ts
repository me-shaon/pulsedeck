import type { Block } from '@pulsedeck/schema';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { serverTimestamp, tsvector } from './columns.js';
import { reportSeverity } from './enums.js';
import { sources } from './sources.js';
import { streams } from './streams.js';

/**
 * Reports — immutable, append-only report instances published by a source
 * (PRD "Reports" + Data Model).
 *
 *  - `blocks` is JSONB typed in TS as `Block[]` from `@pulsedeck/schema`.
 *  - `idempotency_key` is client-generated; `(source_id, idempotency_key)` is
 *    unique so a retried push dedups to the original row.
 *  - `occurred_at` is agent-supplied; `received_at`/`created_at` are server
 *    timestamps. Ordering and retention use server time.
 *  - `search_vector` is a plain `tsvector` over title + summary + tags with a
 *    GIN index, powering Postgres full-text search. It is populated by the
 *    ingest INSERT (Phase 5), NOT a generated column: a STORED generated column
 *    requires an IMMUTABLE expression, but `to_tsvector('english', ...)` is only
 *    STABLE (the text/regconfig config is resolved via catalog/search_path), so
 *    Postgres rejects it (error 42P17). Reports are append-only and never
 *    updated, so a write-time-computed vector can never go stale.
 *
 * Both FKs cascade on delete: a report belongs to a stream (deleting a
 * workspace → category → stream removes its reports) and to a source (deleting
 * a source removes its reports). Reports are never updated after insert.
 */
export const reports = pgTable(
  'reports',
  {
    id: text('id').primaryKey(),
    streamId: text('stream_id')
      .notNull()
      .references(() => streams.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    severity: reportSeverity('severity'),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    receivedAt: serverTimestamp('received_at'),
    createdAt: serverTimestamp('created_at'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    blocks: jsonb('blocks').$type<Block[]>().notNull(),
    // Plain tsvector, populated by the ingest INSERT (Phase 5) as
    // `to_tsvector('english', title || ' ' || summary || ' ' || tags...)`.
    // Not a generated column — see the table doc above (error 42P17).
    searchVector: tsvector('search_vector'),
  },
  (t) => [
    uniqueIndex('reports_source_idempotency_uq').on(t.sourceId, t.idempotencyKey),
    index('reports_stream_occurred_idx').on(t.streamId, t.occurredAt.desc()),
    index('reports_search_vector_idx').using('gin', t.searchVector),
  ],
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
