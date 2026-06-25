import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../src/auth/auth.js';
import type { Db } from '../src/db/index.js';
import type { Report } from '../src/db/index.js';
import type { Sql } from '../src/db.js';
import {
  createIngestionBus,
  type ReportIngestedEvent,
  type ReportLifecycleEvent,
} from '../src/events/ingestion.js';
import {
  createRealtime,
  toRealtimeEvent,
  toRealtimeLifecycleEvent,
  type RealtimeLifecycleEvent,
  type RealtimeReportEvent,
  type RedisLike,
} from '../src/events/realtime.js';
import { buildServer } from '../src/server.js';

/** Build a minimal committed-report ingestion event for the given workspace. */
function makeEvent(workspaceId: string, reportId: string): ReportIngestedEvent {
  return {
    workspaceId,
    categoryId: `cat-${workspaceId}`,
    streamId: `stm-${workspaceId}`,
    report: {
      id: reportId,
      streamId: `stm-${workspaceId}`,
      sourceId: 'src1',
      idempotencyKey: reportId,
      title: `Report ${reportId}`,
      summary: null,
      severity: 'info',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      receivedAt: new Date('2026-01-01T00:00:01.000Z'),
      createdAt: new Date('2026-01-01T00:00:01.000Z'),
      tags: [],
      blocks: [],
      searchVector: '',
    } as unknown as Report,
  };
}

/**
 * In-memory fake satisfying {@link RedisLike}. Captures publishes and lets a test
 * drive inbound `message` events, so the Redis fan-out logic is exercised without
 * a live Redis.
 */
class FakeRedis implements RedisLike {
  published: { channel: string; message: string }[] = [];
  subscribed: string[] = [];
  private messageHandlers: ((channel: string, message: string) => void)[] = [];
  quitCalls = 0;

  constructor(public readonly url: string) {}

  publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    return Promise.resolve(1);
  }
  subscribe(channel: string): Promise<number> {
    this.subscribed.push(channel);
    return Promise.resolve(1);
  }
  on(event: string, listener: (...args: never[]) => void): this {
    if (event === 'message') {
      this.messageHandlers.push(listener as (c: string, m: string) => void);
    }
    return this;
  }
  quit(): Promise<'OK'> {
    this.quitCalls += 1;
    return Promise.resolve('OK');
  }

  /** Test helper: simulate a message arriving on the subscribed channel. */
  deliver(channel: string, message: string): void {
    for (const h of this.messageHandlers) h(channel, message);
  }
}

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe('toRealtimeEvent', () => {
  it('projects a full ingestion event onto a compact, JSON-safe payload', () => {
    const evt = toRealtimeEvent(makeEvent('ws1', 'r1'));
    expect(evt).toEqual({
      workspaceId: 'ws1',
      reportId: 'r1',
      streamId: 'stm-ws1',
      categoryId: 'cat-ws1',
      severity: 'info',
      title: 'Report r1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      receivedAt: '2026-01-01T00:00:01.000Z',
    });
    // Never carries blocks.
    expect('blocks' in evt).toBe(false);
  });
});

function lifecycle(workspaceId: string, kind: ReportLifecycleEvent['kind']): ReportLifecycleEvent {
  return { kind, workspaceId, streamId: `stm-${workspaceId}`, reportIds: ['r1', 'r2'] };
}

describe('toRealtimeLifecycleEvent', () => {
  it('projects a bus lifecycle event onto the id-only realtime payload', () => {
    const evt = toRealtimeLifecycleEvent(lifecycle('ws1', 'archived'));
    expect(evt).toEqual({
      kind: 'archived',
      workspaceId: 'ws1',
      streamId: 'stm-ws1',
      reportIds: ['r1', 'r2'],
    });
  });
});

describe('realtime lifecycle fan-out', () => {
  it('fans a local lifecycle event to subscribers and isolates by workspace', async () => {
    const bus = createIngestionBus();
    const rt = createRealtime({ bus, logger: silentLogger });
    await rt.start();

    const wsA: RealtimeLifecycleEvent[] = [];
    rt.onReportLifecycle((e) => {
      if (e.workspaceId === 'wsA') wsA.push(e);
    });
    const wsB: RealtimeLifecycleEvent[] = [];
    rt.onReportLifecycle((e) => {
      if (e.workspaceId === 'wsB') wsB.push(e);
    });

    bus.emitReportLifecycle(lifecycle('wsA', 'deleted'));

    expect(wsA.map((e) => e.kind)).toEqual(['deleted']);
    expect(wsB).toEqual([]);
    await rt.close();
  });

  it('publishes lifecycle events to Redis tagged type=lifecycle, and re-emits remote ones', async () => {
    const clients: FakeRedis[] = [];
    const bus = createIngestionBus();
    const rt = createRealtime({
      bus,
      redisUrl: 'redis://localhost:6379',
      channel: 'test:rt',
      logger: silentLogger,
      createRedisClient: (url) => {
        const c = new FakeRedis(url);
        clients.push(c);
        return c;
      },
    });
    await rt.start();

    const received: RealtimeLifecycleEvent[] = [];
    rt.onReportLifecycle((e) => received.push(e));

    // Local emit → delivered locally AND published with type 'lifecycle'.
    bus.emitReportLifecycle(lifecycle('wsA', 'archived'));
    expect(received.map((e) => e.kind)).toEqual(['archived']);
    const env = JSON.parse(clients[0].published[0].message);
    expect(env.type).toBe('lifecycle');
    expect(env.event.reportIds).toEqual(['r1', 'r2']);

    // Remote lifecycle event arrives → re-emitted locally, not re-published.
    clients[1].deliver(
      'test:rt',
      JSON.stringify({
        origin: 'other',
        type: 'lifecycle',
        event: { kind: 'unarchived', workspaceId: 'wsA', streamId: 'stm', reportIds: ['r9'] },
      }),
    );
    expect(received.map((e) => e.kind)).toEqual(['archived', 'unarchived']);
    expect(clients[0].published).toHaveLength(1); // remote not re-published
    await rt.close();
  });
});

describe('realtime fan-out (in-process tier)', () => {
  it('fans a local ingest to subscribers and isolates by workspace', async () => {
    const bus = createIngestionBus();
    const rt = createRealtime({ bus, logger: silentLogger });
    await rt.start();
    expect(rt.mode).toBe('in-process');

    const wsA: RealtimeReportEvent[] = [];
    const wsB: RealtimeReportEvent[] = [];
    // Each subscriber filters to its own workspace, exactly like the SSE route.
    rt.onReportIngested((e) => {
      if (e.workspaceId === 'wsA') wsA.push(e);
    });
    rt.onReportIngested((e) => {
      if (e.workspaceId === 'wsB') wsB.push(e);
    });

    bus.emitReportIngested(makeEvent('wsA', 'r1'));

    expect(wsA.map((e) => e.reportId)).toEqual(['r1']);
    expect(wsB).toEqual([]); // other workspace never sees it
    await rt.close();
  });

  it('unsubscribe removes the listener (no leak after disconnect)', async () => {
    const bus = createIngestionBus();
    const rt = createRealtime({ bus, logger: silentLogger });
    await rt.start();

    const handler = vi.fn();
    const unsubscribe = rt.onReportIngested(handler);

    bus.emitReportIngested(makeEvent('wsA', 'r1'));
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe(); // simulate SSE client disconnect

    bus.emitReportIngested(makeEvent('wsA', 'r2'));
    expect(handler).toHaveBeenCalledTimes(1); // not called again
    await rt.close();
  });

  it('a throwing subscriber does not break sibling subscribers', async () => {
    const bus = createIngestionBus();
    const rt = createRealtime({ bus, logger: silentLogger });
    await rt.start();

    const good = vi.fn();
    rt.onReportIngested(() => {
      throw new Error('boom');
    });
    rt.onReportIngested(good);

    expect(() => bus.emitReportIngested(makeEvent('wsA', 'r1'))).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    await rt.close();
  });

  it('close() detaches the bus subscription (no further delivery)', async () => {
    const bus = createIngestionBus();
    const rt = createRealtime({ bus, logger: silentLogger });
    await rt.start();
    const handler = vi.fn();
    rt.onReportIngested(handler);
    await rt.close();

    bus.emitReportIngested(makeEvent('wsA', 'r1'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('is a pure in-process passthrough when REDIS_URL is unset (factory never used)', async () => {
    const createRedisClient = vi.fn();
    const bus = createIngestionBus();
    const rt = createRealtime({ bus, logger: silentLogger, createRedisClient });
    await rt.start();

    expect(rt.mode).toBe('in-process');
    expect(createRedisClient).not.toHaveBeenCalled(); // no Redis without redisUrl
    await rt.close();
  });
});

describe('realtime fan-out (redis tier)', () => {
  const CHANNEL = 'test:report.ingested';

  function setup() {
    const clients: FakeRedis[] = [];
    const createRedisClient = (url: string): RedisLike => {
      const c = new FakeRedis(url);
      clients.push(c);
      return c;
    };
    const bus = createIngestionBus();
    const rt = createRealtime({
      bus,
      redisUrl: 'redis://localhost:6379',
      channel: CHANNEL,
      logger: silentLogger,
      createRedisClient,
    });
    return { bus, rt, clients, pub: () => clients[0], sub: () => clients[1] };
  }

  it('connects two clients and publishes local events to the channel', async () => {
    const { bus, rt, clients, pub, sub } = setup();
    await rt.start();

    expect(rt.mode).toBe('redis');
    expect(clients).toHaveLength(2); // dedicated pub + sub connections
    expect(sub().subscribed).toEqual([CHANNEL]);

    const received: RealtimeReportEvent[] = [];
    rt.onReportIngested((e) => received.push(e));

    bus.emitReportIngested(makeEvent('wsA', 'r1'));

    // Local clients get it immediately, AND it is published for other replicas.
    expect(received.map((e) => e.reportId)).toEqual(['r1']);
    expect(pub().published).toHaveLength(1);
    const envelope = JSON.parse(pub().published[0].message);
    expect(envelope.event.reportId).toBe('r1');
    expect(typeof envelope.origin).toBe('string');
    expect(pub().published[0].channel).toBe(CHANNEL);
    await rt.close();
  });

  it('re-emits a REMOTE event locally and never re-publishes it (no echo back)', async () => {
    const { rt, pub, sub } = setup();
    await rt.start();

    const received: RealtimeReportEvent[] = [];
    rt.onReportIngested((e) => received.push(e));

    const remote: RealtimeReportEvent = {
      workspaceId: 'wsA',
      reportId: 'remote-1',
      streamId: 'stm',
      categoryId: 'cat',
      severity: 'critical',
      title: 'From replica B',
      occurredAt: '2026-01-01T00:00:00.000Z',
      receivedAt: '2026-01-01T00:00:01.000Z',
    };
    sub().deliver(CHANNEL, JSON.stringify({ origin: 'some-other-replica', event: remote }));

    expect(received.map((e) => e.reportId)).toEqual(['remote-1']);
    // Crucial: a Redis-sourced event is NOT re-published (would be a fan-out storm).
    expect(pub().published).toHaveLength(0);
    await rt.close();
  });

  it('drops its own echo (origin === self) — no echo loop', async () => {
    const { bus, rt, pub, sub } = setup();
    await rt.start();

    const received: RealtimeReportEvent[] = [];
    rt.onReportIngested((e) => received.push(e));

    // Local emit → delivered locally once, and published with our own origin.
    bus.emitReportIngested(makeEvent('wsA', 'r1'));
    expect(received).toHaveLength(1);
    const ownOrigin = JSON.parse(pub().published[0].message).origin;

    // Redis echoes our own message back to us (self-subscribed channel).
    sub().deliver(CHANNEL, pub().published[0].message);

    // Must NOT be delivered a second time.
    expect(received).toHaveLength(1);
    expect(ownOrigin).toBeTruthy();
    await rt.close();
  });

  it('ignores malformed Redis messages without throwing', async () => {
    const { rt, sub } = setup();
    await rt.start();
    const received: RealtimeReportEvent[] = [];
    rt.onReportIngested((e) => received.push(e));

    expect(() => sub().deliver(CHANNEL, 'not json')).not.toThrow();
    expect(() => sub().deliver(CHANNEL, JSON.stringify({ origin: 'x' }))).not.toThrow();
    expect(received).toHaveLength(0);
    await rt.close();
  });

  it('falls back to in-process when the Redis factory throws (graceful degradation)', async () => {
    const bus = createIngestionBus();
    const rt = createRealtime({
      bus,
      redisUrl: 'redis://localhost:6379',
      logger: silentLogger,
      createRedisClient: () => {
        throw new Error('connection refused');
      },
    });
    await rt.start(); // must not reject

    expect(rt.mode).toBe('in-process');
    // Local fan-out still works after the failed Redis init.
    const handler = vi.fn();
    rt.onReportIngested(handler);
    bus.emitReportIngested(makeEvent('wsA', 'r1'));
    expect(handler).toHaveBeenCalledTimes(1);
    await rt.close();
  });

  it('quits Redis connections on close', async () => {
    const { rt, clients } = setup();
    await rt.start();
    await rt.close();
    expect(clients.every((c) => c.quitCalls === 1)).toBe(true);
  });
});

// --- App boots and wires realtime with NO Redis (the key invariant) ----------

const reachableSql = (() => Promise.resolve([{ ok: 1 }])) as unknown as Sql;
const stubDb = {} as Db;
const stubAuth = {} as Auth;

describe('buildServer wires realtime without Redis', () => {
  let app: ReturnType<typeof buildServer> | null = null;
  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('boots in-process, registers the SSE route, and /healthz still works', async () => {
    app = buildServer({ sql: reachableSql, db: stubDb, auth: stubAuth });
    await app.realtime.start();
    await app.ready();

    expect(app.realtime.mode).toBe('in-process');
    expect(app.sseEnabled).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/api/v1/workspaces/:id/events' })).toBe(true);

    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'up' });
  });

  it('respects sseEnabled=false (Polling tier) — route still registered', async () => {
    app = buildServer({ sql: reachableSql, db: stubDb, auth: stubAuth, sseEnabled: false });
    await app.ready();
    expect(app.sseEnabled).toBe(false);
    expect(app.hasRoute({ method: 'GET', url: '/api/v1/workspaces/:id/events' })).toBe(true);
  });
});
