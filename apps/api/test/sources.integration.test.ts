import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth, type Auth, type AuthEnv } from '../src/auth/auth.js';
import { makeRequireSource } from '../src/auth/source.js';
import { generateRegToken, hashToken } from '../src/auth/tokens.js';
import {
  categories,
  createDrizzle,
  id,
  reports,
  sourceRegistrationTokens,
  sources,
  streams,
  type Db,
} from '../src/db/index.js';
import type { Sql } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { buildServer } from '../src/server.js';

/**
 * End-to-end Source registration & management tests against a real Postgres.
 * Gated on DATABASE_URL (skipped otherwise). Mirrors the Phase 3 harness:
 * postgres-js (`max: 5`), migrate, truncate, build via `buildServer`. A tiny
 * `/test/source/whoami` route is mounted to exercise the bearer middleware.
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

describeIfDb('sources: registration & management (integration)', () => {
  let sql: Sql;
  let db: Db;
  let auth: Auth;
  let app: FastifyInstance;

  const admin = { name: 'Ada', email: `admin-${id('usr')}@example.com`, password: 'supersecret1' };
  const editor = {
    name: 'Edie',
    email: `editor-${id('usr')}@example.com`,
    password: 'supersecret2',
  };
  let workspaceId: string;
  let adminUserId: string;
  let adminCookie: string;
  let editorCookie: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sql);
    await runMigrations(sql);
    await sql`TRUNCATE users, billing_accounts, workspaces, workspace_members, invites, sources,
      source_registration_tokens, source_categories, source_streams, categories,
      streams, reports, account, session, verification RESTART IDENTITY CASCADE`;

    auth = createAuth(db, AUTH_ENV);
    app = buildServer({ sql, env: AUTH_ENV, auth });

    // Mount a throwaway route to drive the source bearer middleware.
    app.get('/test/source/whoami', { preHandler: [makeRequireSource(db)] }, async (request) => ({
      sourceId: request.source!.id,
      name: request.source!.name,
    }));
    await app.ready();

    // First admin via /setup, then an Editor member via invite/accept.
    const setup = await app.inject({ method: 'POST', url: '/api/v1/setup', payload: admin });
    workspaceId = setup.json().workspace.id;
    adminUserId = setup.json().user.id;
    adminCookie = cookieFromInject(setup.headers['set-cookie']);

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
  });

  afterAll(async () => {
    await app?.close();
    await sql?.end({ timeout: 5 });
  });

  // --- Schema discovery -----------------------------------------------------

  it('GET /api/v1/schema returns version + descriptor (public)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/schema' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe('1.0');
    expect(body.schema.version).toBe('1.0');
    expect(Array.isArray(body.schema.blocks)).toBe(true);
  });

  // --- Create source + RBAC -------------------------------------------------

  let sourceId: string;
  let regToken: string;

  it('Admin creates a source → reg token + copyable setup prompt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/sources`,
      headers: { cookie: adminCookie },
      payload: { name: 'Hermes Prod' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    sourceId = body.source.id;
    regToken = body.registrationToken;

    expect(sourceId).toMatch(/^src_/);
    expect(regToken).toMatch(/^reg_/);
    // Setup prompt is self-contained: BASE_URL, the reg token, and schema info.
    expect(body.setupPrompt).toContain(AUTH_ENV.BETTER_AUTH_URL);
    expect(body.setupPrompt).toContain(regToken);
    expect(body.setupPrompt).toContain('1.0');
    expect(body.schema.version).toBe('1.0');
  });

  it('Editor cannot create a source (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/sources`,
      headers: { cookie: editorCookie },
      payload: { name: 'Nope' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Non-member cannot create a source (404, existence hidden)', async () => {
    const stranger = await auth.api.signUpEmail({
      body: { name: 'Guido', email: `guido-${id('usr')}@example.com`, password: 'supersecret9' },
      returnHeaders: true,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/sources`,
      headers: { cookie: cookieFromHeaders(stranger.headers) },
      payload: { name: 'Nope' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('a freshly created (un-registered) source lists as "never"', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/sources`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const row = res.json().sources.find((s: { id: string }) => s.id === sourceId);
    expect(row).toMatchObject({ status: 'never', reportCount: 0, agentVersion: null });
  });

  // --- Registration handshake ----------------------------------------------

  let apiKey: string;

  it('valid registration token → pd_ key + schema, then source is "active"', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sources/register',
      headers: { 'x-registration-token': regToken },
      // A name in the register body must NOT overwrite the dashboard-set name.
      payload: { name: 'Agent Self-Name', agent_version: '2.1.0' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source_id).toBe(sourceId);
    expect(body.api_key).toMatch(/^pd_/);
    expect(body.schema.version).toBe('1.0');
    apiKey = body.api_key;

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/sources`,
      headers: { cookie: adminCookie },
    });
    const row = list.json().sources.find((s: { id: string }) => s.id === sourceId);
    // Name stays the operator's 'Hermes Prod', not the agent's self-reported name.
    expect(row).toMatchObject({ status: 'active', agentVersion: '2.1.0', name: 'Hermes Prod' });
  });

  it('the registration token is now single-use (second use → 409)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sources/register',
      headers: { 'x-registration-token': regToken },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  it('unknown registration token → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sources/register',
      headers: { 'x-registration-token': generateRegToken() },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('missing registration token header → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sources/register',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('expired registration token → 410', async () => {
    const raw = generateRegToken();
    await db.insert(sourceRegistrationTokens).values({
      id: id('regtok'),
      sourceId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() - 1000),
      createdBy: adminUserId,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sources/register',
      headers: { 'x-registration-token': raw },
      payload: {},
    });
    expect(res.statusCode).toBe(410);
  });

  // --- Bearer middleware ----------------------------------------------------

  it('valid pd_ key resolves the source and bumps last_seen_at', async () => {
    // Reset last-seen so the bump is observable.
    await db
      .update(sources)
      .set({ lastSeenAt: null })
      .where(drizzleSql`id = ${sourceId}`);
    const res = await app.inject({
      method: 'GET',
      url: '/test/source/whoami',
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sourceId });

    // Bump is fire-and-forget — give it a tick to land.
    await new Promise((r) => setTimeout(r, 150));
    const [row] = await db
      .select({ lastSeenAt: sources.lastSeenAt })
      .from(sources)
      .where(drizzleSql`id = ${sourceId}`);
    expect(row.lastSeenAt).not.toBeNull();
  });

  it('missing / garbage bearer keys → 401', async () => {
    const none = await app.inject({ method: 'GET', url: '/test/source/whoami' });
    expect(none.statusCode).toBe(401);
    const garbage = await app.inject({
      method: 'GET',
      url: '/test/source/whoami',
      headers: { authorization: 'Bearer pd_not-a-real-key' },
    });
    expect(garbage.statusCode).toBe(401);
  });

  // --- Rotate / revoke ------------------------------------------------------

  it('rotate: the old key 401s and the new key works', async () => {
    const rot = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/sources/${sourceId}/rotate`,
      headers: { cookie: adminCookie },
    });
    expect(rot.statusCode).toBe(200);
    const newKey = rot.json().api_key as string;
    expect(newKey).toMatch(/^pd_/);
    expect(newKey).not.toBe(apiKey);

    const oldRes = await app.inject({
      method: 'GET',
      url: '/test/source/whoami',
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(oldRes.statusCode).toBe(401);

    const newRes = await app.inject({
      method: 'GET',
      url: '/test/source/whoami',
      headers: { authorization: `Bearer ${newKey}` },
    });
    expect(newRes.statusCode).toBe(200);
    apiKey = newKey;
  });

  it('revoke: the key 401s but the source + history remain', async () => {
    // Seed a report so we can confirm history survives revocation.
    const catId = id('cat');
    const stmId = id('stm');
    await db.insert(categories).values({ id: catId, workspaceId, name: 'Ops', slug: 'ops' });
    await db
      .insert(streams)
      .values({ id: stmId, categoryId: catId, name: 'Builds', slug: 'builds' });
    await db.insert(reports).values({
      id: id('rpt'),
      streamId: stmId,
      workspaceId,
      sourceId,
      idempotencyKey: 'k1',
      title: 'Build report',
      occurredAt: new Date(),
      blocks: [],
      searchVector: drizzleSql`to_tsvector('english', 'build report')`,
    });

    const rev = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/sources/${sourceId}/revoke`,
      headers: { cookie: adminCookie },
    });
    expect(rev.statusCode).toBe(204);

    const denied = await app.inject({
      method: 'GET',
      url: '/test/source/whoami',
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(denied.statusCode).toBe(401);

    // Source still listed; report count reflects retained history.
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/sources`,
      headers: { cookie: adminCookie },
    });
    const row = list.json().sources.find((s: { id: string }) => s.id === sourceId);
    expect(row).toMatchObject({ reportCount: 1 });
  });

  // --- Re-issue + scope -----------------------------------------------------

  it('re-issue produces a fresh token + setup prompt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/sources/${sourceId}/tokens`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.registrationToken).toMatch(/^reg_/);
    expect(body.registrationToken).not.toBe(regToken);
    expect(body.setupPrompt).toContain(body.registrationToken);
  });

  it('PATCH rejects a category grant from another workspace (400)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}/sources/${sourceId}`,
      headers: { cookie: adminCookie },
      payload: { scope: 'category', categoryIds: ['cat_does_not_exist'] },
    });
    expect(res.statusCode).toBe(400);
  });
});
