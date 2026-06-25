import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IngestionBus, ReportIngestedEvent, ReportLifecycleEvent } from './ingestion.js';

/**
 * Realtime fan-out layer (PRD §7 "Realtime Updates" — the three tiers).
 *
 * This wraps the in-process {@link IngestionBus} and is the single thing SSE
 * connections subscribe to. It supports two of the three tiers; the third
 * (Polling) is the absence of SSE entirely and needs nothing here:
 *
 *   - Single-instance SSE (no `REDIS_URL`): every committed report emitted on the
 *     in-process bus is forwarded to this layer's local subscribers (the SSE
 *     clients on THIS process). Pure in-process, no Redis.
 *   - Multi-instance SSE (`REDIS_URL` set): in addition to the above, each local
 *     event is PUBLISHED to a Redis channel, and a second Redis connection
 *     SUBSCRIBES to that channel and re-emits remote events to local SSE clients.
 *     So a report ingested on replica A reaches SSE clients on replica B.
 *
 * Invariants:
 *   - No echo loop: messages are tagged with this process's `instanceId`; a
 *     message received from Redis whose origin is us is ignored, and a message
 *     received from Redis is re-emitted LOCALLY but never re-published.
 *   - Graceful degradation: Redis is connected lazily and only when `REDIS_URL`
 *     is set; any Redis failure is logged and the layer continues as
 *     single-instance (local clients already received the event in-process).
 *   - The compact {@link RealtimeReportEvent} is fanned out — never the full
 *     report blocks — so the client can prepend/invalidate cheaply.
 */

const EVENT = 'report';
const EVENT_LIFECYCLE = 'report.lifecycle';
const DEFAULT_CHANNEL = 'pulsedeck:report.ingested';

/** Compact, JSON-safe payload fanned out to SSE clients (no blocks). */
export interface RealtimeReportEvent {
  workspaceId: string;
  reportId: string;
  streamId: string;
  categoryId: string;
  severity: string | null;
  title: string;
  /** ISO-8601 strings (JSON round-trips through Redis without Date ambiguity). */
  occurredAt: string;
  receivedAt: string;
}

export type RealtimeHandler = (event: RealtimeReportEvent) => void;

/**
 * Compact lifecycle payload (archive/unarchive/delete) fanned out to SSE clients.
 * Already id-only — the client invalidates the affected stream's report lists.
 */
export interface RealtimeLifecycleEvent {
  kind: 'archived' | 'unarchived' | 'deleted';
  workspaceId: string;
  streamId: string;
  reportIds: string[];
}

export type RealtimeLifecycleHandler = (event: RealtimeLifecycleEvent) => void;

export type RealtimeMode = 'in-process' | 'redis';

export interface Realtime {
  /** Subscribe a local SSE connection; returns an unsubscribe function. */
  onReportIngested(handler: RealtimeHandler): () => void;
  /** Subscribe to archive/unarchive/delete events; returns an unsubscribe function. */
  onReportLifecycle(handler: RealtimeLifecycleHandler): () => void;
  /** Connect Redis when `REDIS_URL` is set; no-op (single-instance) otherwise. */
  start(): Promise<void>;
  /** Detach the bus subscription and close Redis connections. */
  close(): Promise<void>;
  /** Current fan-out mode (resolved after {@link start}). */
  readonly mode: RealtimeMode;
}

export interface RealtimeLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string, err?: unknown): void;
}

/**
 * Minimal Redis surface this layer depends on (satisfied by `ioredis`). Kept
 * tiny and injectable so the fan-out logic is testable with a fake — no live
 * Redis required for unit tests.
 */
export interface RedisLike {
  publish(channel: string, message: string): unknown;
  subscribe(channel: string): unknown;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
  quit(): unknown;
  disconnect?(): void;
}

export interface RealtimeOptions {
  /** In-process bus to layer on (defaults provided by `buildServer`). */
  bus: IngestionBus;
  /** When set, enables the multi-instance (Redis) tier. */
  redisUrl?: string;
  /** Redis pub/sub channel. Defaults to a PulseDeck-namespaced channel. */
  channel?: string;
  logger?: RealtimeLogger;
  /**
   * Factory for Redis connections. Injected by tests to supply a fake; in
   * production it is undefined and `ioredis` is dynamically imported (only when
   * `REDIS_URL` is set), so the optional dep is never loaded otherwise.
   */
  createRedisClient?: (url: string) => RedisLike;
}

const consoleLogger: RealtimeLogger = {
  info: (m) => console.info(m),
  warn: (m) => console.warn(m),
  error: (m, err) => console.error(m, err ?? ''),
};

/** Coerce a server/agent timestamp (Date, ISO string, or missing) to an ISO string. */
function iso(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

/** Project a full ingestion event onto the compact realtime payload. */
export function toRealtimeEvent(event: ReportIngestedEvent): RealtimeReportEvent {
  const r = event.report;
  return {
    workspaceId: event.workspaceId,
    reportId: r.id,
    streamId: event.streamId,
    categoryId: event.categoryId,
    severity: r.severity ?? null,
    title: r.title,
    occurredAt: iso(r.occurredAt),
    receivedAt: iso(r.receivedAt),
  };
}

/** Project a bus lifecycle event onto the compact realtime payload (id-only). */
export function toRealtimeLifecycleEvent(event: ReportLifecycleEvent): RealtimeLifecycleEvent {
  return {
    kind: event.kind,
    workspaceId: event.workspaceId,
    streamId: event.streamId,
    reportIds: event.reportIds,
  };
}

/**
 * Envelope published to Redis so receivers can drop their own echoes. `type`
 * discriminates the two event families on the shared channel; it is optional on
 * the wire and defaults to `ingested` so older-format messages still decode.
 */
interface RedisEnvelope {
  origin: string;
  type?: 'ingested' | 'lifecycle';
  event: RealtimeReportEvent | RealtimeLifecycleEvent;
}

class RealtimeFanout implements Realtime {
  // Local fan-out point: SSE connections subscribe here. Fed by BOTH the
  // in-process bus (local ingests) and the Redis subscriber (remote ingests).
  private readonly local = new EventEmitter().setMaxListeners(0);
  private readonly bus: IngestionBus;
  private readonly redisUrl?: string;
  private readonly channel: string;
  private readonly logger: RealtimeLogger;
  private readonly createClient?: (url: string) => RedisLike;
  /** Identifies this process so we can ignore our own Redis echoes. */
  private readonly instanceId = `rt_${randomUUID()}`;

  private unsubBus: (() => void) | null = null;
  private unsubLifecycleBus: (() => void) | null = null;
  private pub: RedisLike | null = null;
  private sub: RedisLike | null = null;
  private started = false;
  private closed = false;
  private _mode: RealtimeMode = 'in-process';
  private redisErrorLogged = false;

  constructor(opts: RealtimeOptions) {
    this.bus = opts.bus;
    this.redisUrl = opts.redisUrl;
    this.channel = opts.channel ?? DEFAULT_CHANNEL;
    this.logger = opts.logger ?? consoleLogger;
    this.createClient = opts.createRedisClient;

    // Subscribe to the in-process bus immediately so local SSE fan-out works
    // even before start() and with no Redis at all. Exactly ONE bus listener
    // per event family backs every SSE client (no per-client bus subscription).
    this.unsubBus = this.bus.onReportIngested((e) => this.onLocalIngest(e));
    this.unsubLifecycleBus = this.bus.onReportLifecycle((e) => this.onLocalLifecycle(e));
  }

  get mode(): RealtimeMode {
    return this._mode;
  }

  onReportIngested(handler: RealtimeHandler): () => void {
    this.local.on(EVENT, handler);
    return () => {
      this.local.off(EVENT, handler);
    };
  }

  onReportLifecycle(handler: RealtimeLifecycleHandler): () => void {
    this.local.on(EVENT_LIFECYCLE, handler);
    return () => {
      this.local.off(EVENT_LIFECYCLE, handler);
    };
  }

  async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    if (!this.redisUrl) {
      this._mode = 'in-process';
      return;
    }

    try {
      const factory = this.createClient ?? (await defaultRedisFactory());
      this.pub = factory(this.redisUrl);
      this.sub = factory(this.redisUrl);

      // Redis errors must never crash the app: log once, keep serving locally.
      const onError = (label: string) => (err: Error) => {
        if (!this.redisErrorLogged) {
          this.redisErrorLogged = true;
          this.logger.warn(
            `[realtime] redis ${label} error; continuing as single-instance SSE: ${err.message}`,
          );
        }
      };
      this.pub.on('error', onError('pub'));
      this.sub.on('error', onError('sub'));
      this.sub.on('message', (channel: string, message: string) => {
        if (channel === this.channel) this.onRedisMessage(message);
      });

      await this.sub.subscribe(this.channel);
      this._mode = 'redis';
      this.logger.info('[realtime] multi-instance SSE enabled (redis pub/sub)');
    } catch (err) {
      // Connecting/importing failed — degrade to single-instance rather than
      // taking down the server. Local SSE keeps working off the in-process bus.
      this.logger.error('[realtime] redis init failed; falling back to single-instance SSE', err);
      this._mode = 'in-process';
      await this.disconnectRedis();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.unsubBus) {
      this.unsubBus();
      this.unsubBus = null;
    }
    if (this.unsubLifecycleBus) {
      this.unsubLifecycleBus();
      this.unsubLifecycleBus = null;
    }
    this.local.removeAllListeners();
    await this.disconnectRedis();
  }

  /** Local committed report: deliver to this replica's SSE clients + fan to Redis. */
  private onLocalIngest(e: ReportIngestedEvent): void {
    const evt = toRealtimeEvent(e);
    this.emitLocal(EVENT, evt);
    this.publish('ingested', evt);
  }

  /** Local lifecycle change: deliver to this replica's SSE clients + fan to Redis. */
  private onLocalLifecycle(e: ReportLifecycleEvent): void {
    const evt = toRealtimeLifecycleEvent(e);
    this.emitLocal(EVENT_LIFECYCLE, evt);
    this.publish('lifecycle', evt);
  }

  /** Deliver to local SSE subscribers of `name` with per-subscriber error isolation. */
  private emitLocal(name: string, evt: RealtimeReportEvent | RealtimeLifecycleEvent): void {
    for (const listener of this.local.listeners(name)) {
      try {
        (listener as (e: typeof evt) => void)(evt);
      } catch (err) {
        this.logger.error('[realtime] sse subscriber threw', err);
      }
    }
  }

  /** Publish a LOCALLY-originated event to Redis (no-op without Redis). */
  private publish(
    type: 'ingested' | 'lifecycle',
    evt: RealtimeReportEvent | RealtimeLifecycleEvent,
  ): void {
    if (!this.pub) return;
    const envelope: RedisEnvelope = { origin: this.instanceId, type, event: evt };
    try {
      const result = this.pub.publish(this.channel, JSON.stringify(envelope));
      // ioredis returns a promise; swallow rejections (Redis down → degrade).
      Promise.resolve(result as unknown).catch(() => {
        if (!this.redisErrorLogged) {
          this.redisErrorLogged = true;
          this.logger.warn('[realtime] redis publish failed; continuing as single-instance SSE');
        }
      });
    } catch {
      // Synchronous publish failure (e.g. offline queue disabled) — drop it;
      // local clients already received the event.
    }
  }

  /** Remote event from another replica: re-emit LOCALLY only, never re-publish. */
  private onRedisMessage(message: string): void {
    let envelope: RedisEnvelope;
    try {
      envelope = JSON.parse(message) as RedisEnvelope;
    } catch {
      return;
    }
    if (!envelope || typeof envelope !== 'object' || !envelope.event) return;
    // No echo loop: drop messages this process published.
    if (envelope.origin === this.instanceId) return;
    // `type` is optional on the wire (older format) — default to ingested.
    if (envelope.type === 'lifecycle') {
      this.emitLocal(EVENT_LIFECYCLE, envelope.event as RealtimeLifecycleEvent);
    } else {
      this.emitLocal(EVENT, envelope.event as RealtimeReportEvent);
    }
  }

  private async disconnectRedis(): Promise<void> {
    const clients = [this.pub, this.sub].filter((c): c is RedisLike => c != null);
    this.pub = null;
    this.sub = null;
    await Promise.all(
      clients.map(async (c) => {
        try {
          await Promise.resolve(c.quit() as unknown);
        } catch {
          try {
            c.disconnect?.();
          } catch {
            // ignore — closing on shutdown, best-effort.
          }
        }
      }),
    );
  }
}

/**
 * Default production Redis factory. Uses a NON-LITERAL dynamic import specifier so
 * `ioredis` is resolved only at runtime (when `REDIS_URL` is set) — it never has
 * to be installed for the app to build, typecheck, or run in the no-Redis tiers.
 */
async function defaultRedisFactory(): Promise<(url: string) => RedisLike> {
  const specifier = 'ioredis';
  const mod = (await import(specifier)) as { default?: unknown };
  const RedisCtor = (mod.default ?? mod) as new (
    url: string,
    opts: Record<string, unknown>,
  ) => RedisLike;
  return (url: string) =>
    new RedisCtor(url, {
      // Don't buffer commands while disconnected — fail fast and degrade rather
      // than growing an unbounded offline queue during a Redis outage.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      // Keep trying to reconnect in the background so multi-instance fan-out
      // self-heals when Redis comes back.
      retryStrategy: (times: number) => Math.min(times * 200, 2000),
    });
}

/** Build the realtime fan-out layer. In-process unless `redisUrl` is provided. */
export function createRealtime(opts: RealtimeOptions): Realtime {
  return new RealtimeFanout(opts);
}
