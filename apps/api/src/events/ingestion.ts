import { EventEmitter } from 'node:events';
import type { Report } from '../db/index.js';

/**
 * In-process ingestion event bus (PRD "Realtime Updates" + "Notifications").
 *
 * After a report is durably committed, the ingestion pipeline emits a
 * `report.ingested` event. This is the single seam later phases attach to:
 *   - Phase 7+ SSE fans this out to connected dashboard clients.
 *   - Phase 8 (v1.1) outbound webhooks subscribe here to route urgent reports.
 *   - Phase 10 swaps the in-process emitter for a Redis pub/sub fan-out across
 *     replicas — the {@link IngestionBus} interface is the swap point, so call
 *     sites never change.
 *
 * Emission happens ONLY for a genuinely new insert, never for an idempotent
 * replay, and ONLY after the transaction commits — subscribers can trust the
 * report exists in Postgres.
 */

/** Payload published when a new report is durably committed. */
export interface ReportIngestedEvent {
  workspaceId: string;
  categoryId: string;
  streamId: string;
  /** The persisted report row (post-commit, server timestamps populated). */
  report: Report;
}

/** Handler invoked for each ingested report. */
export type ReportIngestedHandler = (event: ReportIngestedEvent) => void;

/**
 * Minimal pub/sub surface the pipeline depends on. Kept tiny and interface-first
 * so Phase 10 can drop in a Redis-backed implementation transparently.
 */
export interface IngestionBus {
  emitReportIngested(event: ReportIngestedEvent): void;
  /** Subscribe; returns an unsubscribe function. */
  onReportIngested(handler: ReportIngestedHandler): () => void;
}

const EVENT = 'report.ingested';

/** Single-process {@link IngestionBus} backed by a Node {@link EventEmitter}. */
class InProcessIngestionBus implements IngestionBus {
  // A high cap: many independent subscribers (SSE clients, webhook router) may
  // attach over the app's lifetime; the default of 10 would warn spuriously.
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  emitReportIngested(event: ReportIngestedEvent): void {
    // Invoke listeners with per-subscriber isolation: the report is already
    // committed when we emit, so a throwing subscriber (a buggy SSE/webhook
    // handler) must NOT propagate up and turn a successful ingest into a 500.
    // Errors are logged and swallowed; one bad subscriber can't break the rest.
    for (const listener of this.emitter.listeners(EVENT)) {
      try {
        (listener as ReportIngestedHandler)(event);
      } catch (err) {
        console.error('[ingestion-bus] report.ingested subscriber threw', err);
      }
    }
  }

  onReportIngested(handler: ReportIngestedHandler): () => void {
    this.emitter.on(EVENT, handler);
    return () => this.emitter.off(EVENT, handler);
  }
}

/**
 * Process-wide singleton bus. Decorated onto the Fastify app in `buildServer`
 * (as `app.ingestionBus`) so routes consume it via the app and tests can import
 * it directly to assert emissions.
 */
export const ingestionBus: IngestionBus = new InProcessIngestionBus();
