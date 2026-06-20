import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
import type { Sql } from '../src/db.js';
import type { Db } from '../src/db/index.js';
import type { Auth } from '../src/auth/auth.js';

/** Tagged-template stub that resolves like `sql\`select 1\``. */
const reachableSql = (() => Promise.resolve([{ ok: 1 }])) as unknown as Sql;

/** Tagged-template stub that throws, simulating an unreachable database. */
const unreachableSql = (() => {
  throw new Error('connection refused');
}) as unknown as Sql;

// /healthz only touches `app.sql`; inject stub db/auth so buildServer never
// constructs a real Drizzle driver or better-auth instance (keeps this DB-less).
const stubDb = {} as Db;
const stubAuth = {} as Auth;

describe('GET /healthz', () => {
  it('returns 200 with db up when the database is reachable', async () => {
    const app = buildServer({ sql: reachableSql, db: stubDb, auth: stubAuth });
    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'up' });

    await app.close();
  });

  it('returns 503 with db down when the database is unreachable', async () => {
    const app = buildServer({ sql: unreachableSql, db: stubDb, auth: stubAuth });
    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'down' });

    await app.close();
  });
});

describe('GET /healthz/retention', () => {
  it('reports retention disabled by default (RETENTION_DAYS unset → 0)', async () => {
    const app = buildServer({ sql: reachableSql, db: stubDb, auth: stubAuth });
    const res = await app.inject({ method: 'GET', url: '/healthz/retention' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(false);
    expect(body.retentionDays).toBe(0);
    expect(body.lastRunAt).toBeNull();
    expect(body.lastOutcome).toBeNull();

    await app.close();
  });

  it('reports retention enabled when a positive window is configured', async () => {
    const app = buildServer({
      sql: reachableSql,
      db: stubDb,
      auth: stubAuth,
      retentionDays: 30,
      retentionSweepIntervalMs: 3_600_000,
    });
    const res = await app.inject({ method: 'GET', url: '/healthz/retention' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.retentionDays).toBe(30);
    expect(body.sweepIntervalMs).toBe(3_600_000);

    await app.close();
  });
});
