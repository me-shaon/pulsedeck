import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth, type Auth, type AuthEnv } from '../src/auth/auth.js';
import {
  categories,
  createDrizzle,
  id,
  reports,
  sources,
  streams,
  workspaceMembers,
  workspaces,
  type Db,
} from '../src/db/index.js';
import type { Sql } from '../src/db.js';
import type { ReportLifecycleEvent } from '../src/events/ingestion.js';
import { runMigrations } from '../src/migrate.js';
import { buildServer } from '../src/server.js';
import { seedAccount } from './helpers.js';

/**
 * Bulk archive/unarchive/delete endpoints end-to-end against a real Postgres
 * (gated on DATABASE_URL; skipped otherwise). Covers happy paths, the
 * `reports:manage` gate (editor allowed, viewer 403), 401/404, body validation,
 * cross-workspace isolation, and realtime lifecycle emission.
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
describeIfDb('reports write APIs (integration)', () => {
  let sqlClient: Sql;
  let db: Db;
  let auth: Auth;
  let app: FastifyInstance;

  let workspaceId: string;
  let editorCookie: string;
  let viewerCookie: string;
  let strangerCookie: string;
  let streamId: string;
  let sourceId: string;
  let foreignWs: string;
  let foreignStreamId: string;
  let foreignSourceId: string;

  async function seedReport(opts: {
    streamId: string;
    workspaceId: string;
    sourceId: string;
    archivedAt?: Date | null;
  }): Promise<string> {
    const rid = id('rpt');
    await db.insert(reports).values({
      id: rid,
      streamId: opts.streamId,
      workspaceId: opts.workspaceId,
      sourceId: opts.sourceId,
      idempotencyKey: rid,
      title: 'seed',
      summary: null,
      severity: null,
      occurredAt: new Date('2026-01-01T00:00:00Z'),
      receivedAt: new Date('2026-01-01T00:00:00Z'),
      archivedAt: opts.archivedAt ?? null,
      tags: [],
      blocks: [],
      searchVector: sql`to_tsvector('english', 'seed')`,
    });
    return rid;
  }

  function post(url: string, body: unknown, cookie: string) {
    return app.inject({ method: 'POST', url, headers: { cookie }, payload: body as object });
  }

  beforeAll(async () => {
    sqlClient = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sqlClient);
    await runMigrations(sqlClient);
    await sqlClient`TRUNCATE users, billing_accounts, workspaces, workspace_members, invites, sources,
      source_registration_tokens, source_categories, source_streams, categories,
      streams, reports, report_metrics, account, session, verification
      RESTART IDENTITY CASCADE`;

    auth = createAuth(db, AUTH_ENV);
    app = buildServer({ sql: sqlClient, env: AUTH_ENV, auth });
    await app.ready();

    // Owner + workspace via setup.
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: { name: 'Ada', email: `owner-${id('usr')}@example.com`, password: 'supersecret1' },
    });
    workspaceId = setup.json().workspace.id;

    // Editor member (the manage-capable role under test).
    const editor = await auth.api.signUpEmail({
      body: { name: 'Ed', email: `editor-${id('usr')}@example.com`, password: 'supersecret2' },
      returnHeaders: true,
    });
    editorCookie = cookieFromHeaders(editor.headers);
    await db
      .insert(workspaceMembers)
      .values({ workspaceId, userId: editor.response.user.id, role: 'editor' });

    // Viewer member (denied).
    const viewer = await auth.api.signUpEmail({
      body: { name: 'Vic', email: `viewer-${id('usr')}@example.com`, password: 'supersecret3' },
      returnHeaders: true,
    });
    viewerCookie = cookieFromHeaders(viewer.headers);
    await db
      .insert(workspaceMembers)
      .values({ workspaceId, userId: viewer.response.user.id, role: 'viewer' });

    // Non-member stranger.
    const stranger = await auth.api.signUpEmail({
      body: { name: 'Stra', email: `stranger-${id('usr')}@example.com`, password: 'supersecret4' },
      returnHeaders: true,
    });
    strangerCookie = cookieFromHeaders(stranger.headers);

    sourceId = id('src');
    await db.insert(sources).values({ id: sourceId, workspaceId, name: 'Seed Agent' });
    const cat = id('cat');
    await db.insert(categories).values({ id: cat, workspaceId, name: 'C', slug: 'c' });
    streamId = id('stm');
    await db.insert(streams).values({ id: streamId, categoryId: cat, name: 'S', slug: 's' });

    // Foreign workspace for isolation checks.
    foreignWs = id('ws');
    const acc2 = await seedAccount(db, 'Other');
    await db
      .insert(workspaces)
      .values({ id: foreignWs, accountId: acc2, name: 'O', slug: `o-${id('ws')}` });
    const cat2 = id('cat');
    await db.insert(categories).values({ id: cat2, workspaceId: foreignWs, name: 'X', slug: 'x' });
    foreignStreamId = id('stm');
    await db
      .insert(streams)
      .values({ id: foreignStreamId, categoryId: cat2, name: 'Y', slug: 'y' });
    foreignSourceId = id('src');
    await db.insert(sources).values({ id: foreignSourceId, workspaceId: foreignWs, name: 'OA' });
  });

  beforeEach(async () => {
    await sqlClient`DELETE FROM reports`;
  });

  afterAll(async () => {
    await app?.close();
    await sqlClient?.end({ timeout: 5 });
  });

  const archiveUrl = () => `/api/v1/workspaces/${workspaceId}/reports/bulk/archive`;
  const unarchiveUrl = () => `/api/v1/workspaces/${workspaceId}/reports/bulk/unarchive`;
  const deleteUrl = () => `/api/v1/workspaces/${workspaceId}/reports/bulk/delete`;

  it('editor can archive selected reports (200, affected count, emits lifecycle event)', async () => {
    const a = await seedReport({ streamId, workspaceId, sourceId });
    const b = await seedReport({ streamId, workspaceId, sourceId });

    const events: ReportLifecycleEvent[] = [];
    const off = app.ingestionBus.onReportLifecycle((e) => events.push(e));

    const res = await post(archiveUrl(), { ids: [a, b] }, editorCookie);
    off();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ affected: 2 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'archived', workspaceId, streamId });
  });

  it('editor can unarchive and hard-delete', async () => {
    const archived = await seedReport({
      streamId,
      workspaceId,
      sourceId,
      archivedAt: new Date('2026-02-01T00:00:00Z'),
    });
    const un = await post(unarchiveUrl(), { ids: [archived] }, editorCookie);
    expect(un.json()).toEqual({ affected: 1 });

    const del = await post(deleteUrl(), { ids: [archived] }, editorCookie);
    expect(del.json()).toEqual({ affected: 1 });
    const [row] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(sql`${reports.id} = ${archived}`);
    expect(row).toBeUndefined(); // gone
  });

  it('viewer is denied (403) on all three', async () => {
    const a = await seedReport({ streamId, workspaceId, sourceId });
    expect((await post(archiveUrl(), { ids: [a] }, viewerCookie)).statusCode).toBe(403);
    expect((await post(unarchiveUrl(), { ids: [a] }, viewerCookie)).statusCode).toBe(403);
    expect((await post(deleteUrl(), { ids: [a] }, viewerCookie)).statusCode).toBe(403);
  });

  it('unauthenticated → 401; non-member → 404', async () => {
    const a = await seedReport({ streamId, workspaceId, sourceId });
    const unauth = await app.inject({
      method: 'POST',
      url: archiveUrl(),
      payload: { ids: [a] } as object,
    });
    expect(unauth.statusCode).toBe(401);
    const stranger = await post(archiveUrl(), { ids: [a] }, strangerCookie);
    expect(stranger.statusCode).toBe(404);
  });

  it('empty ids → 400; oversized ids → 400', async () => {
    expect((await post(archiveUrl(), { ids: [] }, editorCookie)).statusCode).toBe(400);
    const tooMany = Array.from({ length: 501 }, (_v, i) => `rpt_${i}`);
    expect((await post(archiveUrl(), { ids: tooMany }, editorCookie)).statusCode).toBe(400);
  });

  it('foreign-workspace ids are not affected (affected excludes them)', async () => {
    const foreign = await seedReport({
      streamId: foreignStreamId,
      workspaceId: foreignWs,
      sourceId: foreignSourceId,
    });
    const res = await post(deleteUrl(), { ids: [foreign] }, editorCookie);
    expect(res.json()).toEqual({ affected: 0 });
    const [row] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(sql`${reports.id} = ${foreign}`);
    expect(row?.id).toBe(foreign); // still present
  });
});
