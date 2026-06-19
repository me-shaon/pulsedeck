import { z } from 'zod';

/**
 * Canonical enums for the PulseDeck wire contract (BLOCK_SCHEMA.md §1).
 *
 * Defined once here and referenced by every block and the report envelope.
 * Validation rejects any value not listed. `trend` (geometry) and `sentiment`
 * (color meaning) are deliberately separate.
 */

/** Report + alert severity. */
export const severitySchema = z.enum(['info', 'warning', 'critical']);
export type Severity = z.infer<typeof severitySchema>;

/** Status block items + timeline event status. */
export const statusSchema = z.enum(['healthy', 'degraded', 'down', 'unknown']);
export type Status = z.infer<typeof statusSchema>;

/** Metric direction (the arrow geometry). */
export const trendSchema = z.enum(['up', 'down', 'flat']);
export type Trend = z.infer<typeof trendSchema>;

/** Metric color meaning. */
export const sentimentSchema = z.enum(['positive', 'negative', 'neutral']);
export type Sentiment = z.infer<typeof sentimentSchema>;

/** Metric / table number format. */
export const formatSchema = z.enum(['number', 'currency', 'percent', 'bytes', 'duration']);
export type Format = z.infer<typeof formatSchema>;

/** Chart geometry variant. */
export const chartVariantSchema = z.enum(['line', 'bar', 'area']);
export type ChartVariant = z.infer<typeof chartVariantSchema>;

/** Table column typing for sort. */
export const columnTypeSchema = z.enum(['string', 'number', 'date']);
export type ColumnType = z.infer<typeof columnTypeSchema>;
