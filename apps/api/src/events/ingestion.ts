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

/** Lifecycle change to existing reports (the archive feature). */
export type ReportLifecycleKind = 'archived' | 'unarchived' | 'deleted';

/**
 * Payload published when existing reports are archived, unarchived, or deleted.
 * Carries only ids (one event batches a whole bulk operation per stream) so SSE
 * clients can invalidate cheaply — never the report bodies.
 */
export interface ReportLifecycleEvent {
  kind: ReportLifecycleKind;
  workspaceId: string;
  streamId: string;
  reportIds: string[];
}

/** Handler invoked for each report-lifecycle change. */
export type ReportLifecycleHandler = (event: ReportLifecycleEvent) => void;

/**
 * Minimal pub/sub surface the pipeline depends on. Kept tiny and interface-first
 * so Phase 10 can drop in a Redis-backed implementation transparently.
 *
 * Note: despite the `Ingestion` name (historical — it began as ingest-only),
 * this bus also carries report-lifecycle events. Generalizing the name is a
 * deferred cosmetic cleanup; the realtime layer and SSE route consume both.
 */
export interface IngestionBus {
  emitReportIngested(event: ReportIngestedEvent): void;
  /** Subscribe; returns an unsubscribe function. */
  onReportIngested(handler: ReportIngestedHandler): () => void;
  emitReportLifecycle(event: ReportLifecycleEvent): void;
  /** Subscribe to archive/unarchive/delete events; returns an unsubscribe function. */
  onReportLifecycle(handler: ReportLifecycleHandler): () => void;
}

const EVENT = 'report.ingested';
const EVENT_LIFECYCLE = 'report.lifecycle';

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

  emitReportLifecycle(event: ReportLifecycleEvent): void {
    // Same per-subscriber isolation as ingest: a throwing SSE/webhook handler
    // must not propagate out of the mutation that emitted this event.
    for (const listener of this.emitter.listeners(EVENT_LIFECYCLE)) {
      try {
        (listener as ReportLifecycleHandler)(event);
      } catch (err) {
        console.error('[ingestion-bus] report.lifecycle subscriber threw', err);
      }
    }
  }

  onReportLifecycle(handler: ReportLifecycleHandler): () => void {
    this.emitter.on(EVENT_LIFECYCLE, handler);
    return () => this.emitter.off(EVENT_LIFECYCLE, handler);
  }
}

/**
 * Construct a fresh, isolated in-process bus. The app uses the {@link ingestionBus}
 * singleton; this factory exists so the realtime fan-out layer and its tests can
 * stand up an independent bus without touching process-wide state.
 */
export function createIngestionBus(): IngestionBus {
  return new InProcessIngestionBus();
}

/**
 * Process-wide singleton bus. Decorated onto the Fastify app in `buildServer`
 * (as `app.ingestionBus`) so routes consume it via the app and tests can import
 * it directly to assert emissions.
 */
export const ingestionBus: IngestionBus = new InProcessIngestionBus();
