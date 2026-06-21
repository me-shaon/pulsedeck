import type { Block } from '@pulsedeck/schema';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth, type Auth, type AuthEnv } from '../src/auth/auth.js';
import {
  categories,
  createDrizzle,
  id,
  reportMetrics,
  reports,
  sources,
  streams,
  workspaceMembers,
  workspaces,
  type Db,
} from '../src/db/index.js';
import type { Sql } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { buildServer } from '../src/server.js';
import { seedAccount } from './helpers.js';

/**
 * Phase 9 dashboards + widget-data APIs end-to-end against a real Postgres
 * (gated on DATABASE_URL; skipped otherwise). Mirrors the Phase 6 harness.
 *
 * Covers: CRUD (first → default, list ordered, get, patch name/layout, reorder,
 * set-default exactly-one flip, delete promotes a default), layout validation
 * (round-trip + unknown type / bad config / bad placement → 422), cross-workspace
 * widget refs rejected on write, RBAC (editor builds, viewer 403, non-member 404,
 * foreign dashboard 404), and the widget-data endpoints (metric latest + delta,
 * series within range, report_count buckets, alert_feed warning|critical only,
 * cross-workspace stream/category → 404).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const AUTH_ENV: AuthEnv = {
  AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
  BETTER_AUTH_URL: 'http://localhost:3001',
};

function cookieFromHeaders(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

function cookieFromInject(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(';')[0]).join('; ');
}

function mdBlocks(n: number): Block[] {
  return Array.from({ length: n }, (_v, i) => ({
    id: `b${i}`,
    type: 'markdown' as const,
    content: `c${i}`,
  }));
}

const layoutWith = (widgets: unknown[]) => ({ version: 1, widgets });

describeIfDb('dashboards + widget-data APIs (integration)', () => {
  let sqlClient: Sql;
  let db: Db;
  let auth: Auth;
  let app: FastifyInstance;

  const admin = { name: 'Ada', email: `admin-${id('usr')}@example.com`, password: 'supersecret1' };
  let workspaceId: string;
  let adminCookie: string;
  let editorCookie: string;
  let viewerCookie: string;
  let strangerCookie: string;

  let sourceId: string;
  let catEng: string; // category in ws1
  let stMetrics: string; // stream in ws1 for metric/series/count
  let stAlerts: string; // stream in ws1 (under catEng) for alerts
  // ws2 (foreign) ids — must never be addressable from ws1.
  let ws2: string;
  let foreignStreamId: string;
  let foreignCategoryId: string;

  async function seedReport(opts: {
    streamId: string;
    title: string;
    severity?: 'info' | 'warning' | 'critical' | null;
    receivedAt: Date;
    occurredAt?: Date;
    source?: string;
  }): Promise<string> {
    const rid = id('rpt');
    await db.insert(reports).values({
      id: rid,
      streamId: opts.streamId,
      workspaceId,
      sourceId: opts.source ?? sourceId,
      idempotencyKey: rid,
      title: opts.title,
      summary: null,
      severity: opts.severity ?? null,
      occurredAt: opts.occurredAt ?? opts.receivedAt,
      receivedAt: opts.receivedAt,
      tags: [],
      blocks: mdBlocks(1),
      searchVector: sql`to_tsvector('english', ${opts.title})`,
    });
    return rid;
  }

  async function seedMetric(opts: {
    reportId: string;
    streamId: string;
    key: string;
    value: number;
    occurredAt: Date;
  }): Promise<void> {
    await db.insert(reportMetrics).values({
      id: id('mtr'),
      reportId: opts.reportId,
      streamId: opts.streamId,
      key: opts.key,
      value: opts.value,
      occurredAt: opts.occurredAt,
    });
  }

  function req(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    payload?: unknown,
  ) {
    return app.inject({ method, url, headers: { cookie }, payload: payload as object });
  }
  const get = (url: string, cookie = adminCookie) => req('GET', url, cookie);

  beforeAll(async () => {
    sqlClient = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sqlClient);
    await runMigrations(sqlClient);
    await sqlClient`TRUNCATE users, accounts, workspaces, workspace_members, invites, sources,
      source_registration_tokens, source_categories, source_streams, categories,
      streams, reports, report_metrics, dashboards, account, session, verification
      RESTART IDENTITY CASCADE`;

    auth = createAuth(db, AUTH_ENV);
    app = buildServer({ sql: sqlClient, env: AUTH_ENV, auth });
    await app.ready();

    const setup = await app.inject({ method: 'POST', url: '/api/v1/setup', payload: admin });
    workspaceId = setup.json().workspace.id;
    adminCookie = cookieFromInject(setup.headers['set-cookie']);

    const editor = await auth.api.signUpEmail({
      body: { name: 'Ed', email: `editor-${id('usr')}@example.com`, password: 'supersecret2' },
      returnHeaders: true,
    });
    editorCookie = cookieFromHeaders(editor.headers);
    await db
      .insert(workspaceMembers)
      .values({ workspaceId, userId: editor.response.user.id, role: 'editor' });

    const viewer = await auth.api.signUpEmail({
      body: { name: 'Vic', email: `viewer-${id('usr')}@example.com`, password: 'supersecret3' },
      returnHeaders: true,
    });
    viewerCookie = cookieFromHeaders(viewer.headers);
    await db
      .insert(workspaceMembers)
      .values({ workspaceId, userId: viewer.response.user.id, role: 'viewer' });

    const stranger = await auth.api.signUpEmail({
      body: { name: 'Stra', email: `stranger-${id('usr')}@example.com`, password: 'supersecret4' },
      returnHeaders: true,
    });
    strangerCookie = cookieFromHeaders(stranger.headers);

    sourceId = id('src');
    await db.insert(sources).values({ id: sourceId, workspaceId, name: 'Seed Agent' });

    catEng = id('cat');
    await db
      .insert(categories)
      .values({ id: catEng, workspaceId, name: 'Engineering', slug: 'engineering', position: 0 });

    stMetrics = id('stm');
    stAlerts = id('stm');
    await db.insert(streams).values([
      { id: stMetrics, categoryId: catEng, name: 'Metrics', slug: 'metrics', position: 0 },
      { id: stAlerts, categoryId: catEng, name: 'Alerts', slug: 'alerts', position: 1 },
    ]);

    // --- report_metrics for metric-latest + series ---------------------------
    const now = Date.now();
    const at = (msAgo: number) => new Date(now - msAgo);
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;

    // latency_p95: three recent samples (10 → 20 → 35) for latest + delta.
    const m1 = await seedReport({ streamId: stMetrics, title: 'm1', receivedAt: at(3 * HOUR) });
    const m2 = await seedReport({ streamId: stMetrics, title: 'm2', receivedAt: at(2 * HOUR) });
    const m3 = await seedReport({ streamId: stMetrics, title: 'm3', receivedAt: at(1 * HOUR) });
    await seedMetric({
      reportId: m1,
      streamId: stMetrics,
      key: 'latency_p95',
      value: 10,
      occurredAt: at(3 * HOUR),
    });
    await seedMetric({
      reportId: m2,
      streamId: stMetrics,
      key: 'latency_p95',
      value: 20,
      occurredAt: at(2 * HOUR),
    });
    await seedMetric({
      reportId: m3,
      streamId: stMetrics,
      key: 'latency_p95',
      value: 35,
      occurredAt: at(1 * HOUR),
    });
    // One ancient sample 40d ago — must fall outside a 30d range.
    const mOld = await seedReport({ streamId: stMetrics, title: 'mOld', receivedAt: at(40 * DAY) });
    await seedMetric({
      reportId: mOld,
      streamId: stMetrics,
      key: 'latency_p95',
      value: 999,
      occurredAt: at(40 * DAY),
    });

    // --- reports for report_count (two on one UTC day, one the previous day) -
    await seedReport({ streamId: stMetrics, title: 'c1', receivedAt: at(1 * HOUR) });
    await seedReport({ streamId: stMetrics, title: 'c2', receivedAt: at(2 * HOUR) });
    await seedReport({ streamId: stMetrics, title: 'c3', receivedAt: at(1 * DAY + 1 * HOUR) });

    // --- reports for alert_feed (info ignored; warning+critical surface) ------
    await seedReport({
      streamId: stAlerts,
      title: 'a-info',
      severity: 'info',
      receivedAt: at(3 * HOUR),
    });
    await seedReport({
      streamId: stAlerts,
      title: 'a-warn',
      severity: 'warning',
      receivedAt: at(2 * HOUR),
    });
    await seedReport({
      streamId: stAlerts,
      title: 'a-crit',
      severity: 'critical',
      receivedAt: at(1 * HOUR),
    });

    // --- foreign workspace (own account) ---------------------------------------
    ws2 = id('ws');
    const account2 = await seedAccount(db, 'Other Account');
    await db
      .insert(workspaces)
      .values({ id: ws2, accountId: account2, name: 'Other', slug: `other-${id('ws')}` });
    foreignCategoryId = id('cat');
    await db
      .insert(categories)
      .values({ id: foreignCategoryId, workspaceId: ws2, name: 'X', slug: 'x' });
    foreignStreamId = id('stm');
    await db
      .insert(streams)
      .values({ id: foreignStreamId, categoryId: foreignCategoryId, name: 'Y', slug: 'y' });
  });

  afterAll(async () => {
    await app?.close();
    await sqlClient?.end({ timeout: 5 });
  });

  // ===========================================================================
  // CRUD
  // ===========================================================================

  let d1: string;
  let d2: string;
  let d3: string;

  it('first dashboard created is default; subsequent ones are not', async () => {
    const r1 = await req('POST', `/api/v1/workspaces/${workspaceId}/dashboards`, adminCookie, {
      name: 'Overview One',
    });
    expect(r1.statusCode).toBe(201);
    d1 = r1.json().dashboard.id;
    expect(r1.json().dashboard).toMatchObject({
      isDefault: true,
      position: 0,
      slug: 'overview-one',
    });
    expect(r1.json().dashboard.layout).toEqual({ version: 1, widgets: [] });

    const r2 = await req('POST', `/api/v1/workspaces/${workspaceId}/dashboards`, editorCookie, {
      name: 'Second',
      icon: 'chart',
    });
    expect(r2.statusCode).toBe(201);
    d2 = r2.json().dashboard.id;
    expect(r2.json().dashboard).toMatchObject({ isDefault: false, position: 1, icon: 'chart' });

    const r3 = await req('POST', `/api/v1/workspaces/${workspaceId}/dashboards`, adminCookie, {
      name: 'Third',
    });
    d3 = r3.json().dashboard.id;
    expect(r3.json().dashboard).toMatchObject({ isDefault: false, position: 2 });
  });

  it('list returns ordered items + the default id, no Overview fallback', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/dashboards`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isOverviewFallback).toBe(false);
    expect(body.defaultDashboardId).toBe(d1);
    expect(body.dashboards.map((d: { id: string }) => d.id)).toEqual([d1, d2, d3]);
    expect(body.dashboards[0]).not.toHaveProperty('layout'); // list is lightweight
  });

  it('get returns the full dashboard incl. normalized layout', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/dashboards/${d1}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().dashboard).toMatchObject({ id: d1, name: 'Overview One', isDefault: true });
    expect(res.json().dashboard.layout).toEqual({ version: 1, widgets: [] });
  });

  it('patch updates name + a valid layout round-trips', async () => {
    const layout = layoutWith([
      {
        id: 'w1',
        type: 'metric',
        span: 'half',
        row: 0,
        config: { streamId: stMetrics, metricKey: 'latency_p95', label: 'P95' },
      },
      {
        id: 'w2',
        type: 'chart',
        span: 'full',
        row: 1,
        config: { streamId: stMetrics, metricKey: 'latency_p95', variant: 'line', range: '7d' },
      },
      {
        id: 'w3',
        type: 'alert_feed',
        span: 'third',
        row: 2,
        config: { categoryId: catEng, limit: 10 },
      },
    ]);
    const res = await req(
      'PATCH',
      `/api/v1/workspaces/${workspaceId}/dashboards/${d2}`,
      editorCookie,
      {
        name: 'Second Renamed',
        layout,
      },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().dashboard.name).toBe('Second Renamed');
    expect(res.json().dashboard.layout).toEqual(layout);
  });

  it('reorder via patch position changes list order', async () => {
    const res = await req(
      'PATCH',
      `/api/v1/workspaces/${workspaceId}/dashboards/${d1}`,
      adminCookie,
      {
        position: 99,
      },
    );
    expect(res.statusCode).toBe(200);
    const list = await get(`/api/v1/workspaces/${workspaceId}/dashboards`);
    expect(list.json().dashboards.map((d: { id: string }) => d.id)).toEqual([d2, d3, d1]);
  });

  it('set-default flips the flag to exactly one dashboard', async () => {
    const res = await req(
      'POST',
      `/api/v1/workspaces/${workspaceId}/dashboards/${d2}/default`,
      adminCookie,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().dashboard).toMatchObject({ id: d2, isDefault: true });

    const list = await get(`/api/v1/workspaces/${workspaceId}/dashboards`);
    const defaults = list.json().dashboards.filter((d: { isDefault: boolean }) => d.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(d2);
    expect(list.json().defaultDashboardId).toBe(d2);
  });

  it('deleting the default promotes the lowest-position survivor', async () => {
    // Current order/positions: d2(pos1,default), d3(pos2), d1(pos99). Delete d2.
    const del = await req(
      'DELETE',
      `/api/v1/workspaces/${workspaceId}/dashboards/${d2}`,
      adminCookie,
    );
    expect(del.statusCode).toBe(204);

    const list = await get(`/api/v1/workspaces/${workspaceId}/dashboards`);
    const rows = list.json().dashboards;
    expect(rows.map((d: { id: string }) => d.id)).toEqual([d3, d1]); // d2 gone
    const defaults = rows.filter((d: { isDefault: boolean }) => d.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(d3); // lowest position survivor promoted
  });

  it('empty workspace surfaces the Overview fallback', async () => {
    const ws = await req('POST', `/api/v1/workspaces`, adminCookie, { name: 'Fresh WS' });
    const freshId = ws.json().workspace.id;
    const res = await get(`/api/v1/workspaces/${freshId}/dashboards`);
    expect(res.json()).toEqual({
      dashboards: [],
      defaultDashboardId: null,
      isOverviewFallback: true,
    });
  });

  // ===========================================================================
  // Layout validation
  // ===========================================================================

  it('unknown widget type → 422', async () => {
    const res = await req('POST', `/api/v1/workspaces/${workspaceId}/dashboards`, adminCookie, {
      name: 'Bad type',
      layout: layoutWith([{ id: 'x', type: 'pie', span: 'full', row: 0, config: {} }]),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('validation_failed');
  });

  it('bad config (missing required field) → 422', async () => {
    const res = await req('POST', `/api/v1/workspaces/${workspaceId}/dashboards`, adminCookie, {
      name: 'Bad config',
      layout: layoutWith([
        { id: 'x', type: 'metric', span: 'full', row: 0, config: { streamId: stMetrics } },
      ]),
    });
    expect(res.statusCode).toBe(422);
  });

  it('bad placement (invalid span) → 422', async () => {
    const res = await req('POST', `/api/v1/workspaces/${workspaceId}/dashboards`, adminCookie, {
      name: 'Bad span',
      layout: layoutWith([
        {
          id: 'x',
          type: 'metric',
          span: 'quarter',
          row: 0,
          config: { streamId: stMetrics, metricKey: 'k' },
        },
      ]),
    });
    expect(res.statusCode).toBe(422);
  });

  it('unknown extra field in config → 422 (strict)', async () => {
    const res = await req('POST', `/api/v1/workspaces/${workspaceId}/dashboards`, adminCookie, {
      name: 'Extra field',
      layout: layoutWith([
        {
          id: 'x',
          type: 'metric',
          span: 'full',
          row: 0,
          config: { streamId: stMetrics, metricKey: 'k', bogus: 1 },
        },
      ]),
    });
    expect(res.statusCode).toBe(422);
  });

  it('a widget referencing a FOREIGN workspace stream → 422', async () => {
    const res = await req('POST', `/api/v1/workspaces/${workspaceId}/dashboards`, adminCookie, {
      name: 'Cross ws',
      layout: layoutWith([
        {
          id: 'x',
          type: 'metric',
          span: 'full',
          row: 0,
          config: { streamId: foreignStreamId, metricKey: 'k' },
        },
      ]),
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json().issues)).toContain(foreignStreamId);
  });

  // ===========================================================================
  // RBAC
  // ===========================================================================

  it('a Viewer cannot build (403); a non-member 404s; unauth 401', async () => {
    const viewer = await req('POST', `/api/v1/workspaces/${workspaceId}/dashboards`, viewerCookie, {
      name: 'Nope',
    });
    expect(viewer.statusCode).toBe(403);

    const stranger = await get(`/api/v1/workspaces/${workspaceId}/dashboards`, strangerCookie);
    expect(stranger.statusCode).toBe(404);

    const unauth = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/dashboards`,
    });
    expect(unauth.statusCode).toBe(401);
  });

  it('a Viewer can read dashboards (reports:view)', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/dashboards`, viewerCookie);
    expect(res.statusCode).toBe(200);
  });

  it('a foreign dashboard id → 404', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/dashboards/dsh_does_not_exist`);
    expect(res.statusCode).toBe(404);
  });

  // ===========================================================================
  // Widget data
  // ===========================================================================

  it('metric latest returns newest value + previous + delta', async () => {
    const res = await get(
      `/api/v1/workspaces/${workspaceId}/streams/${stMetrics}/metrics/latency_p95/latest`,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.latest.value).toBe(35);
    expect(body.previous.value).toBe(20);
    expect(body.delta).toBe(15);
  });

  it('metric latest for an unknown key → empty (nulls), not error', async () => {
    const res = await get(
      `/api/v1/workspaces/${workspaceId}/streams/${stMetrics}/metrics/nope/latest`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ latest: null, previous: null, delta: null });
  });

  it('series returns ordered points within the range (ancient sample excluded)', async () => {
    const res = await get(
      `/api/v1/workspaces/${workspaceId}/streams/${stMetrics}/metrics/latency_p95/series?range=30d`,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.range).toBe('30d');
    expect(body.points.map((p: { value: number }) => p.value)).toEqual([10, 20, 35]); // asc, no 999
    // ascending by occurredAt
    const ts = body.points.map((p: { occurredAt: string }) => Date.parse(p.occurredAt));
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('series rejects an invalid range → 400', async () => {
    const res = await get(
      `/api/v1/workspaces/${workspaceId}/streams/${stMetrics}/metrics/latency_p95/series?range=1y`,
    );
    expect(res.statusCode).toBe(400);
  });

  it('report_count buckets reports by day for a stream', async () => {
    const res = await get(
      `/api/v1/workspaces/${workspaceId}/reports/count?scope=stream&targetId=${stMetrics}&bucket=day&range=7d`,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bucket).toBe('day');
    const total = body.buckets.reduce((s: number, b: { count: number }) => s + b.count, 0);
    // 3 metric reports + 3 count reports + ... all stMetrics reports within 7d.
    // At minimum the two same-day count reports share a bucket.
    expect(body.buckets.length).toBeGreaterThanOrEqual(2);
    expect(total).toBeGreaterThanOrEqual(3);
    // buckets are ascending by time
    const order = body.buckets.map((b: { bucket: string }) => b.bucket);
    expect(order).toEqual([...order].sort());
  });

  it('report_count for a category works and rejects bad params', async () => {
    const ok = await get(
      `/api/v1/workspaces/${workspaceId}/reports/count?scope=category&targetId=${catEng}&bucket=hour&range=24h`,
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.json().scope).toBe('category');

    const badBucket = await get(
      `/api/v1/workspaces/${workspaceId}/reports/count?scope=stream&targetId=${stMetrics}&bucket=week`,
    );
    expect(badBucket.statusCode).toBe(400);

    const badScope = await get(
      `/api/v1/workspaces/${workspaceId}/reports/count?scope=galaxy&targetId=${stMetrics}`,
    );
    expect(badScope.statusCode).toBe(400);
  });

  it('alert_feed returns only warning|critical in the category, newest first', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/categories/${catEng}/alerts`);
    expect(res.statusCode).toBe(200);
    const titles = res.json().alerts.map((a: { title: string }) => a.title);
    expect(titles).toEqual(['a-crit', 'a-warn']); // newest-first, info excluded
    expect(res.json().alerts.every((a: { severity: string }) => a.severity !== 'info')).toBe(true);
  });

  it('alert_feed rejects an out-of-range limit → 400', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/categories/${catEng}/alerts?limit=99`);
    expect(res.statusCode).toBe(400);
  });

  // ===========================================================================
  // Cross-workspace isolation on widget endpoints
  // ===========================================================================

  it('a foreign stream/category is not addressable from this workspace (404)', async () => {
    const m = await get(
      `/api/v1/workspaces/${workspaceId}/streams/${foreignStreamId}/metrics/latency_p95/latest`,
    );
    expect(m.statusCode).toBe(404);

    const s = await get(
      `/api/v1/workspaces/${workspaceId}/streams/${foreignStreamId}/metrics/latency_p95/series`,
    );
    expect(s.statusCode).toBe(404);

    const c = await get(
      `/api/v1/workspaces/${workspaceId}/reports/count?scope=stream&targetId=${foreignStreamId}`,
    );
    expect(c.statusCode).toBe(404);

    const a = await get(`/api/v1/workspaces/${workspaceId}/categories/${foreignCategoryId}/alerts`);
    expect(a.statusCode).toBe(404);
  });
});
