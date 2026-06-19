import { doublePrecision, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { reports } from './reports.js';
import { streams } from './streams.js';

/**
 * Report metrics — denormalized from `metric` blocks at ingest (PRD Data Model
 * notes). Dashboard metric/chart widgets query this flat, indexed table by
 * `(stream_id, key)` instead of scanning JSONB across thousands of reports.
 *
 * `stream_id` is carried (not just `report_id`) so widget time-series queries
 * hit the index without joining back to `reports`. Deleting a report removes
 * its extracted metrics; deleting a stream cascades likewise.
 */
export const reportMetrics = pgTable(
  'report_metrics',
  {
    id: text('id').primaryKey(),
    reportId: text('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    streamId: text('stream_id')
      .notNull()
      .references(() => streams.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: doublePrecision('value').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [index('report_metrics_stream_key_occurred_idx').on(t.streamId, t.key, t.occurredAt)],
);

export type ReportMetric = typeof reportMetrics.$inferSelect;
export type NewReportMetric = typeof reportMetrics.$inferInsert;
