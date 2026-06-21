import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth, type Auth, type AuthEnv } from '../src/auth/auth.js';
import { categories, createDrizzle, id, reportMetrics, reports, type Db } from '../src/db/index.js';
import type { Sql } from '../src/db.js';
import { ingestionBus, type ReportIngestedEvent } from '../src/events/ingestion.js';
import { runMigrations } from '../src/migrate.js';
import { buildServer } from '../src/server.js';

/**
 * Phase 5 ingestion API end-to-end tests against a real Postgres (gated on
 * DATABASE_URL; skipped otherwise). Mirrors the Phase 4 harness: postgres-js,
 * migrate, truncate, build via `buildServer`. Exercises the full status-code
 * contract, the idempotency race, scope + autocreate, search_vector population,
 * metric extraction, the ingestion event, and per-source rate limiting.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const AUTH_ENV: AuthEnv = {
  AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
  BETTER_AUTH_URL: 'http://localhost:3001',
};

function cookieFromInject(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(';')[0]).join('; ');
}

/** Canonical PRD report envelope (Canonical Report Schema), slugs parameterized. */
function canonicalReport(opts?: { category?: string; stream?: string }) {
  return {
    version: '1.0',
    workspace: 'my-ecommerce-app',
    source: { id: 'src_ignored_from_body' },
    category: { slug: opts?.category ?? 'engineering' },
    stream: { slug: opts?.stream ?? 'daily-infra-reports' },
    report: {
      title: 'Daily Infrastructure Summary',
      summary: '2 incidents detected, avg latency up 14%.',
      severity: 'warning',
      occurred_at: '2026-05-22T10:00:00Z',
      tags: ['production', 'infra'],
    },
    blocks: [
      {
        id: 'blk_1',
        type: 'metric',
        key: 'api_latency',
        label: 'Avg API Latency',
        value: 421,
        unit: 'ms',
      },
      { id: 'blk_2', type: 'markdown', content: 'Latency increased 14% compared to yesterday.' },
      {
        id: 'blk_3',
        type: 'table',
        columns: [
          { key: 'service', label: 'Service', type: 'string' },
          { key: 'status', label: 'Status', type: 'string' },
        ],
        rows: [
          { service: 'API', status: 'Healthy' },
          { service: 'Worker', status: 'Warning' },
        ],
      },
    ],
  };
}

describeIfDb('reports: ingestion API (integration)', () => {
  let sql: Sql;
  let db: Db;
  let auth: Auth;
  let app: FastifyInstance;

  const admin = { name: 'Ada', email: `admin-${id('usr')}@example.com`, password: 'supersecret1' };
  let workspaceId: string;
  let adminCookie: string;

  // A workspace-scoped source with autocreate on (the default) — the common case.
  let wsApiKey: string;
  let wsSourceId: string;

  /** Create + register a source, returning its raw API key + id. */
  async function provisionSource(payload: Record<string, unknown> = {}): Promise<{
    sourceId: string;
    apiKey: string;
  }> {
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/sources`,
      headers: { cookie: adminCookie },
      payload: { name: 'Test Agent', ...payload },
    });
    const sourceId = create.json().source.id as string;
    const regToken = create.json().registrationToken as string;
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/sources/register',
      headers: { 'x-registration-token': regToken },
      payload: { name: 'Test Agent', agent_version: '1.0.0' },
    });
    return { sourceId, apiKey: reg.json().api_key as string };
  }

  function push(
    apiKey: string,
    body: unknown,
    key: string | null,
    extraHeaders: Record<string, string> = {},
  ) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    };
    if (key !== null) headers['idempotency-key'] = key;
    return app.inject({ method: 'POST', url: '/api/v1/reports', headers, payload: body as object });
  }

  beforeAll(async () => {
    // Effectively disable per-source rate limiting for the main app; a dedicated
    // test below builds a separate app with a tiny limit.
    process.env.INGEST_RATE_LIMIT = '100000';

    sql = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sql);
    await runMigrations(sql);
    await sql`TRUNCATE users, accounts, workspaces, workspace_members, invites, sources,
      source_registration_tokens, source_categories, source_streams, categories,
      streams, reports, report_metrics, account, session, verification
      RESTART IDENTITY CASCADE`;

    auth = createAuth(db, AUTH_ENV);
    app = buildServer({ sql, env: AUTH_ENV, auth });
    await app.ready();

    const setup = await app.inject({ method: 'POST', url: '/api/v1/setup', payload: admin });
    workspaceId = setup.json().workspace.id;
    adminCookie = cookieFromInject(setup.headers['set-cookie']);

    const provisioned = await provisionSource();
    wsSourceId = provisioned.sourceId;
    wsApiKey = provisioned.apiKey;
  });

  afterAll(async () => {
    await app?.close();
    await sql?.end({ timeout: 5 });
  });

  // --- Happy path -----------------------------------------------------------

  it('canonical PRD report → 201 with correct row, blocks, tags, severity, search_vector', async () => {
    const res = await push(wsApiKey, canonicalReport(), 'canon-1');
    expect(res.statusCode).toBe(201);
    const reportId = res.json().report.id as string;
    expect(reportId).toMatch(/^rpt_/);

    const [row] = await db.select().from(reports).where(eq(reports.id, reportId));
    expect(row.tags).toEqual(['production', 'infra']);
    expect(row.severity).toBe('warning');
    expect(row.blocks).toHaveLength(3);
    expect(row.blocks[0]).toMatchObject({ type: 'metric', key: 'api_latency', value: 421 });
    expect(row.receivedAt).toBeInstanceOf(Date);
    expect(row.sourceId).toBe(wsSourceId);
    // workspace_id is denormalized from the authenticated source at ingest.
    expect(row.workspaceId).toBe(workspaceId);
    // occurred_at is agent-supplied and preserved verbatim.
    expect(row.occurredAt.toISOString()).toBe('2026-05-22T10:00:00.000Z');

    // search_vector is populated: a title word matches via to_tsquery.
    const [m] = await sql`
      select (search_vector @@ to_tsquery('english', 'infrastructure')) as match
      from reports where id = ${reportId}`;
    expect(m.match).toBe(true);
  });

  // --- Idempotency ----------------------------------------------------------

  it('replay with the same key → 200 returning the original, no duplicate row', async () => {
    const first = await push(wsApiKey, canonicalReport({ stream: 'idem' }), 'idem-key');
    expect(first.statusCode).toBe(201);
    const originalId = first.json().report.id;

    const replay = await push(wsApiKey, canonicalReport({ stream: 'idem' }), 'idem-key');
    expect(replay.statusCode).toBe(200);
    expect(replay.json().status).toBe('duplicate');
    expect(replay.json().report.id).toBe(originalId);

    const rows = await db.select().from(reports).where(eq(reports.idempotencyKey, 'idem-key'));
    expect(rows).toHaveLength(1);
  });

  it('a different key → a new 201', async () => {
    const res = await push(wsApiKey, canonicalReport({ stream: 'idem' }), 'idem-key-2');
    expect(res.statusCode).toBe(201);
    expect(res.json().report.id).toMatch(/^rpt_/);
  });

  it('concurrent identical pushes (same key) → exactly one report row', async () => {
    const body = canonicalReport({ stream: 'race' });
    const [a, b] = await Promise.all([
      push(wsApiKey, body, 'race-key'),
      push(wsApiKey, body, 'race-key'),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    // Exactly one insert (201) and one idempotent replay (200).
    expect(codes).toEqual([200, 201]);

    const rows = await db.select().from(reports).where(eq(reports.idempotencyKey, 'race-key'));
    expect(rows).toHaveLength(1);
  });

  // --- Missing idempotency key ----------------------------------------------

  it('missing Idempotency-Key → 400', async () => {
    const res = await push(wsApiKey, canonicalReport(), null);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('missing_idempotency_key');
  });

  // --- Validation -----------------------------------------------------------

  it('invalid block (metric value as string) → 422 with exact issue shape', async () => {
    // Build a payload with blocks[0].value as a string (must be a number). Kept
    // as a plain object so the route receives it as an untyped body (unknown).
    const body = {
      ...canonicalReport(),
      blocks: [
        {
          id: 'blk_1',
          type: 'metric',
          key: 'api_latency',
          label: 'Avg API Latency',
          value: 'high',
        },
      ],
    };
    const res = await push(wsApiKey, body, 'bad-block');
    expect(res.statusCode).toBe(422);
    const json = res.json();
    expect(json.error).toBe('validation_failed');
    expect(json.schema_version).toBe('1.0');
    expect(json.issues).toContainEqual(
      expect.objectContaining({
        path: 'blocks[0].value',
        message: 'Expected number, received string',
      }),
    );
  });

  // --- Oversize payload -----------------------------------------------------

  it('oversize payload (> 1 MB) → 422 (not 413)', async () => {
    const body = canonicalReport({ stream: 'big' });
    // 50 markdown blocks × ~30 KB each ≈ 1.5 MB > 1 MB cap, each block valid.
    body.blocks = Array.from({ length: 50 }, (_v, i) => ({
      id: `blk_${i}`,
      type: 'markdown' as const,
      content: 'x'.repeat(30_000),
    }));
    const res = await push(wsApiKey, body, 'oversize');
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('validation_failed');
  });

  it('too many blocks (> 50) → 422 validation', async () => {
    const body = canonicalReport({ stream: 'many' });
    body.blocks = Array.from({ length: 51 }, (_v, i) => ({
      id: `blk_${i}`,
      type: 'markdown' as const,
      content: 'short',
    }));
    const res = await push(wsApiKey, body, 'too-many-blocks');
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('validation_failed');
  });

  // --- Scope ----------------------------------------------------------------

  it('workspace-scoped source may write anywhere in its workspace (autocreate) → 201', async () => {
    const res = await push(
      wsApiKey,
      canonicalReport({ category: 'brand-new-cat', stream: 'brand-new-stream' }),
      'ws-anywhere',
    );
    expect(res.statusCode).toBe(201);
  });

  it('category-scoped source: granted category → 201, non-granted → 403', async () => {
    // Seed a category to grant, plus an un-granted one.
    const grantedCatId = id('cat');
    await db
      .insert(categories)
      .values({ id: grantedCatId, workspaceId, name: 'Granted', slug: 'granted-cat' });
    await db
      .insert(categories)
      .values({ id: id('cat'), workspaceId, name: 'Other', slug: 'other-cat' });

    const { apiKey } = await provisionSource({ scope: 'category', categoryIds: [grantedCatId] });

    // Granted category, new stream → autocreate within grant → 201.
    const ok = await push(
      apiKey,
      canonicalReport({ category: 'granted-cat', stream: 'cat-scoped-stream' }),
      'cat-ok',
    );
    expect(ok.statusCode).toBe(201);

    // Non-granted (but existing) category → 403.
    const denied = await push(
      apiKey,
      canonicalReport({ category: 'other-cat', stream: 'whatever' }),
      'cat-denied',
    );
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe('out_of_scope');
  });

  // --- Autocreate off → 409 -------------------------------------------------

  it('autocreate OFF: unknown stream slug → 409', async () => {
    const { apiKey } = await provisionSource({ allowStreamAutocreate: false });
    const res = await push(
      apiKey,
      canonicalReport({ category: 'noauto-cat', stream: 'noauto-stream' }),
      'noauto',
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('unknown_slug');
  });

  it('autocreate ON: unknown stream slug → creates the stream + 201', async () => {
    const res = await push(
      wsApiKey,
      canonicalReport({ category: 'auto-cat', stream: 'auto-stream' }),
      'auto-on',
    );
    expect(res.statusCode).toBe(201);
    const streamId = res.json().report.stream_id as string;
    expect(streamId).toMatch(/^stm_/);
  });

  // --- Metric extraction ----------------------------------------------------

  it('report with 2 metric blocks → 2 report_metrics rows', async () => {
    const body = {
      ...canonicalReport({ stream: 'metrics' }),
      blocks: [
        { id: 'm1', type: 'metric', key: 'mrr', label: 'MRR', value: 1000, unit: 'usd' },
        { id: 'm2', type: 'metric', key: 'churn', label: 'Churn', value: 2.5, unit: '%' },
        { id: 'md', type: 'markdown', content: 'note' },
      ],
    };
    const res = await push(wsApiKey, body, 'metrics-key');
    expect(res.statusCode).toBe(201);
    const reportId = res.json().report.id as string;
    const streamId = res.json().report.stream_id as string;

    const rows = await db.select().from(reportMetrics).where(eq(reportMetrics.reportId, reportId));
    expect(rows).toHaveLength(2);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.mrr).toMatchObject({ value: 1000, streamId });
    expect(byKey.churn).toMatchObject({ value: 2.5, streamId });
  });

  // --- Ingestion event ------------------------------------------------------

  it('onReportIngested fires once for a new report, never for a replay', async () => {
    const events: ReportIngestedEvent[] = [];
    const unsubscribe = ingestionBus.onReportIngested((e) => events.push(e));
    try {
      const created = await push(wsApiKey, canonicalReport({ stream: 'evt' }), 'evt-key');
      expect(created.statusCode).toBe(201);
      const reportId = created.json().report.id;

      const replay = await push(wsApiKey, canonicalReport({ stream: 'evt' }), 'evt-key');
      expect(replay.statusCode).toBe(200);

      const forThis = events.filter((e) => e.report.id === reportId);
      expect(forThis).toHaveLength(1);
      expect(forThis[0]).toMatchObject({ workspaceId, streamId: created.json().report.stream_id });
      expect(forThis[0].categoryId).toMatch(/^cat_/);
    } finally {
      unsubscribe();
    }
  });

  // --- Rate limiting (dedicated app with a tiny limit) ----------------------

  it('exceeding the per-source rate limit → 429', async () => {
    const prev = process.env.INGEST_RATE_LIMIT;
    process.env.INGEST_RATE_LIMIT = '2';
    const app2 = buildServer({ sql, env: AUTH_ENV, auth });
    await app2.ready();
    try {
      const inject = () =>
        app2.inject({
          method: 'POST',
          url: '/api/v1/reports',
          headers: { authorization: `Bearer ${wsApiKey}`, 'idempotency-key': id('rpt') },
          payload: {}, // invalid body — still counts toward the limit
        });
      const r1 = await inject();
      const r2 = await inject();
      const r3 = await inject();
      expect(r1.statusCode).not.toBe(429);
      expect(r2.statusCode).not.toBe(429);
      expect(r3.statusCode).toBe(429);
    } finally {
      await app2.close();
      process.env.INGEST_RATE_LIMIT = prev;
    }
  });
});
