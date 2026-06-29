import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuth, type Auth, type AuthEnv } from '../src/auth/auth.js';
import {
  billingAccounts,
  categories,
  createDrizzle,
  id,
  reports,
  sources,
  streams,
  webhookDeliveries,
  workspaces,
  type Db,
  type Report,
} from '../src/db/index.js';
import type { Sql } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { buildServer } from '../src/server.js';
import { createWebhookRunner, type WebhookRunner } from '../src/webhooks/index.js';
import { verifySignature } from '../src/webhooks/signing.js';

/**
 * End-to-end webhook tests against a real Postgres (skipped without DATABASE_URL).
 * Covers route RBAC + secret-once, SSRF + limit gating, the ingestion→enqueue
 * fan-out (severity/category matching), the delivery runner (HMAC, retry, SSE-
 * style isolation), and that a delivery survives its report being purged.
 *
 * The runner is injected with a fake `fetch` so we drive delivery deterministically
 * via `runOnce()` instead of the timer.
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

describeIfDb('webhooks (integration)', () => {
  let sql: Sql;
  let db: Db;
  let auth: Auth;
  let app: FastifyInstance;
  let runner: WebhookRunner;

  // Fake fetch: default 200; tests flip `nextStatus` / `throwOnce` to drive paths.
  let nextStatus = 200;
  let throwNext = false;
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers as Record<string, string>) ?? {},
      body: String(init?.body ?? ''),
    });
    if (throwNext) {
      throwNext = false;
      throw new Error('connection refused');
    }
    return new Response(null, { status: nextStatus });
  });

  const admin = { name: 'Ada', email: `admin-${id('usr')}@example.com`, password: 'supersecret1' };
  const editor = { name: 'Ed', email: `editor-${id('usr')}@example.com`, password: 'supersecret2' };

  let workspaceId: string;
  let accountId: string;
  let adminCookie: string;
  let editorCookie: string;
  let categoryEng: string;
  let categoryMkt: string;
  let streamId: string;
  let sourceId: string;

  async function insertReport(over: Partial<Report> = {}): Promise<Report> {
    const ts = new Date();
    const [row] = await db
      .insert(reports)
      .values({
        id: id('rpt'),
        streamId,
        workspaceId,
        sourceId,
        idempotencyKey: id('rpt'),
        title: 'Event',
        severity: 'critical',
        occurredAt: ts,
        blocks: [],
        searchVector: '',
        ...over,
      })
      .returning();
    return row;
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sql);
    await runMigrations(sql);
    await sql`TRUNCATE users, billing_accounts, workspaces, workspace_members, invites, sources,
      source_registration_tokens, source_categories, source_streams, categories,
      streams, reports, webhooks, webhook_deliveries, account, session, verification
      RESTART IDENTITY CASCADE`;

    auth = createAuth(db, AUTH_ENV);
    runner = createWebhookRunner({
      db,
      pollIntervalMs: 60_000,
      batchSize: 50,
      deliveryTimeoutMs: 2000,
      allowPrivateIps: true, // self-host default; lets us target example URLs
      fetchImpl: fakeFetch as unknown as typeof fetch,
      jitter: () => 0,
    });
    app = buildServer({ sql, env: AUTH_ENV, auth, webhookRunner: runner });
    await app.ready();

    const setup = await app.inject({ method: 'POST', url: '/api/v1/setup', payload: admin });
    workspaceId = setup.json().workspace.id;
    adminCookie = cookieFromInject(setup.headers['set-cookie']);
    accountId = (
      await db
        .select({ accountId: workspaces.accountId })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1)
    )[0].accountId;

    // An editor member (lacks webhooks:manage).
    const signup = await auth.api.signUpEmail({
      body: { name: editor.name, email: editor.email, password: editor.password },
      returnHeaders: true,
    });
    editorCookie = cookieFromHeaders(signup.headers);
    const invite = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invites`,
      headers: { cookie: adminCookie },
      payload: { role: 'editor' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/invites/accept',
      headers: { cookie: editorCookie },
      payload: { token: invite.json().invite.token },
    });

    // Structure + a source, inserted directly.
    categoryEng = id('cat');
    categoryMkt = id('cat');
    streamId = id('stm');
    sourceId = id('src');
    await db.insert(categories).values([
      { id: categoryEng, workspaceId, name: 'Engineering', slug: 'engineering' },
      { id: categoryMkt, workspaceId, name: 'Marketing', slug: 'marketing' },
    ]);
    await db
      .insert(streams)
      .values({ id: streamId, categoryId: categoryEng, name: 'API', slug: 'api' });
    await db.insert(sources).values({ id: sourceId, workspaceId, name: 'Hermes' });
  });

  afterAll(async () => {
    await app?.close();
    await sql?.end({ timeout: 5 });
  });

  // --- CRUD + RBAC + secret-once -------------------------------------------

  let webhookId: string;
  let firstSecret: string;

  it('admin creates a webhook → 201 with one-time secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/webhooks`,
      headers: { cookie: adminCookie },
      payload: {
        name: 'Critical → Slack',
        url: 'https://example.com/hook',
        format: 'generic',
        severities: ['critical'],
        categoryIds: [categoryEng],
      },
    });
    expect(res.statusCode).toBe(201);
    const wh = res.json().webhook;
    webhookId = wh.id;
    firstSecret = wh.secret;
    expect(webhookId).toMatch(/^wh_/);
    expect(firstSecret).toMatch(/^whsec_/);
    expect(wh.severities).toEqual(['critical']);
    expect(wh.categoryIds).toEqual([categoryEng]);
  });

  it('list/detail never expose the secret', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/webhooks`,
      headers: { cookie: adminCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().webhooks[0]).not.toHaveProperty('secret');

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.json().webhook).not.toHaveProperty('secret');
  });

  it('editor (no webhooks:manage) is forbidden', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/webhooks`,
      headers: { cookie: editorCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a non-http(s) URL (SSRF/scheme guard, 422)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/webhooks`,
      headers: { cookie: adminCookie },
      payload: { name: 'bad', url: 'ftp://example.com' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('invalid_url');
  });

  it('rotate-secret returns a fresh secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}/rotate-secret`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const secret = res.json().secret;
    expect(secret).toMatch(/^whsec_/);
    expect(secret).not.toBe(firstSecret);
    firstSecret = secret;
  });

  it('enforces per-account max_webhooks (402)', async () => {
    await db
      .update(billingAccounts)
      .set({ maxWebhooks: 1 })
      .where(eq(billingAccounts.id, accountId));
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/webhooks`,
      headers: { cookie: adminCookie },
      payload: { name: 'second', url: 'https://example.com/two' },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().limit).toBe('webhooks');
    await db
      .update(billingAccounts)
      .set({ maxWebhooks: null })
      .where(eq(billingAccounts.id, accountId));
  });

  // --- Ingestion → enqueue matching ----------------------------------------

  async function tick(): Promise<void> {
    // enqueue is fire-and-forget; let its microtasks settle.
    await new Promise((r) => setTimeout(r, 50));
  }

  it('a matching report enqueues exactly one delivery', async () => {
    const report = await insertReport({ severity: 'critical' });
    app.ingestionBus.emitReportIngested({
      workspaceId,
      categoryId: categoryEng,
      streamId,
      report,
    });
    await tick();
    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.reportId, report.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
  });

  it('a non-matching report (wrong severity) enqueues nothing', async () => {
    const report = await insertReport({ severity: 'warning' });
    app.ingestionBus.emitReportIngested({ workspaceId, categoryId: categoryEng, streamId, report });
    await tick();
    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.reportId, report.id));
    expect(rows).toHaveLength(0);
  });

  it('a non-matching report (wrong category) enqueues nothing', async () => {
    const report = await insertReport({ severity: 'critical' });
    app.ingestionBus.emitReportIngested({ workspaceId, categoryId: categoryMkt, streamId, report });
    await tick();
    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.reportId, report.id));
    expect(rows).toHaveLength(0);
  });

  // --- Delivery runner ------------------------------------------------------

  it('runner delivers a pending row and signs the generic payload', async () => {
    calls.length = 0;
    nextStatus = 200;
    const outcome = await runner.runOnce();
    expect(outcome).toBe('delivered');
    expect(fakeFetch).toHaveBeenCalled();
    const sent = calls[calls.length - 1];
    const sig = sent.headers['x-pulsedeck-signature'];
    expect(sig).toBeTruthy();
    expect(verifySignature(firstSecret, sent.body, sig)).toBe(true);

    const [row] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.status, 'success'));
    expect(row.status).toBe('success');
    expect(row.lastStatusCode).toBe(200);
  });

  it('a 500 response schedules a retry (back to pending, future next_attempt_at)', async () => {
    const report = await insertReport({ severity: 'critical' });
    app.ingestionBus.emitReportIngested({ workspaceId, categoryId: categoryEng, streamId, report });
    await tick();
    nextStatus = 500;
    await runner.runOnce();
    const [row] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.reportId, report.id));
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastStatusCode).toBe(500);
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('reclaims an orphaned "delivering" row whose claim lease expired', async () => {
    // Simulate a delivery the runner claimed (status=delivering) but never
    // finalized — process crashed mid-send, or a finalize write failed. Its lease
    // (next_attempt_at) is long past, so the next poll must reclaim and retry it
    // rather than leaving it stranded in `delivering` forever.
    const report = await insertReport({ severity: 'critical' });
    const deliveryId = id('whd');
    await db.insert(webhookDeliveries).values({
      id: deliveryId,
      webhookId,
      reportId: report.id,
      maxAttempts: 5,
      payload: { event: 'report.created', deliveryId },
      status: 'delivering',
      nextAttemptAt: new Date(Date.now() - 60_000),
    });
    calls.length = 0;
    nextStatus = 200;
    await runner.runOnce();
    const [row] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));
    expect(row.status).toBe('success');
  });

  it('delivery log lists attempts; redeliver re-queues a terminal row', async () => {
    const log = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}/deliveries?limit=10`,
      headers: { cookie: adminCookie },
    });
    expect(log.statusCode).toBe(200);
    const items = log.json().items;
    expect(items.length).toBeGreaterThan(0);

    const success = items.find((d: { status: string }) => d.status === 'success');
    const re = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}/deliveries/${success.id}/redeliver`,
      headers: { cookie: adminCookie },
    });
    expect(re.statusCode).toBe(202);
    const [row] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, success.id));
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
  });

  it('test-delivery enqueues a synthetic row with no report', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}/test`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(202);
    const deliveryId = res.json().deliveryId;
    const [row] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));
    expect(row.reportId).toBeNull();
  });

  it('a delivery survives its report being purged (reportId nulled)', async () => {
    const report = await insertReport({ severity: 'critical' });
    app.ingestionBus.emitReportIngested({ workspaceId, categoryId: categoryEng, streamId, report });
    await tick();
    await db.delete(reports).where(eq(reports.id, report.id));
    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId));
    // The delivery row remains, its FK set to null, payload intact.
    const survivor = rows.find((r) => r.reportId === null && r.payload);
    expect(survivor).toBeTruthy();
  });
});
