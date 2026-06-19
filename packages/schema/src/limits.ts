/**
 * Ingestion limits for the PulseDeck wire contract (BLOCK_SCHEMA.md §3).
 *
 * All but {@link MAX_PAYLOAD_BYTES} are enforced in-schema (see `blocks.ts`
 * and `report.ts`). The payload-size cap is enforced at the HTTP layer in a
 * later phase; it is exported here so the API can reuse the single constant.
 */
export const LIMITS = {
  /** Maximum blocks per report. */
  blocksPerReport: 50,
  /** Maximum rows in a table block. */
  tableRows: 1000,
  /** Maximum columns in a table block. */
  tableColumns: 20,
  /** Maximum series in a chart block. */
  chartSeries: 10,
  /** Maximum data points per chart series. */
  chartPointsPerSeries: 500,
  /** Maximum characters in a markdown block. */
  markdownChars: 50_000,
  /** Maximum payload size in bytes (HTTP-layer enforcement, not in-schema). */
  payloadBytes: 1_048_576, // 1 MB
} as const;

export type Limits = typeof LIMITS;

/** Convenience alias for the HTTP-layer payload cap. */
export const MAX_PAYLOAD_BYTES = LIMITS.payloadBytes;
