import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';
import { createAuth, type Auth, type AuthEnv } from '../src/auth/auth.js';
import { runBootstrap } from '../src/auth/setup.js';
import { createDrizzle, id, invites, type Db } from '../src/db/index.js';
import { runMigrations } from '../src/migrate.js';
import { buildServer } from '../src/server.js';
import type { Sql } from '../src/db.js';

/**
 * End-to-end auth/onboarding/RBAC tests against a real Postgres. Gated on
 * DATABASE_URL (skipped otherwise) so the default unit run needs no DB. The
 * controller generates+applies the migration, then runs this against Postgres.
 *
 * Sessions are minted server-side via `auth.api.*` (bypassing better-auth's
 * HTTP CSRF/origin checks, which are not the unit under test); the resulting
 * session cookie is then replayed against our `/api/v1` routes to exercise the
 * auth preHandlers + RBAC exactly as a browser would.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const AUTH_ENV: AuthEnv = {
  AUTH_SECRET: 'test-secret-test-secret-test-secret-123', // >= 32 chars
  BETTER_AUTH_URL: 'http://localhost:3001',
};

/** Build a `Cookie` header from a web `Headers`' Set-Cookie list. */
function cookieFromHeaders(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** Build a `Cookie` header from a Fastify inject response's set-cookie. */
function cookieFromInject(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(';')[0]).join('; ');
}

describeIfDb('auth + onboarding + RBAC (integration)', () => {
  let sql: Sql;
  let db: Db;
  let auth: Auth;
  let app: FastifyInstance;

  // Shared state threaded across the ordered `it`s.
  const admin = { name: 'Ada', email: `admin-${id('usr')}@example.com`, password: 'supersecret1' };
  const member = {
    name: 'Linus',
    email: `member-${id('usr')}@example.com`,
    password: 'supersecret2',
  };
  let workspaceId: string;
  let adminCookie: string;
  let memberCookie: string;
  let memberUserId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sql);
    await runMigrations(sql);

    // Clean slate so the zero-users setup flow is deterministic.
    await sql`TRUNCATE users, billing_accounts, workspaces, workspace_members, invites, account, session, verification RESTART IDENTITY CASCADE`;

    auth = createAuth(db, AUTH_ENV);
    app = buildServer({ sql, env: AUTH_ENV, auth });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await sql?.end({ timeout: 5 });
  });

  it('reports setupRequired=true and githubEnabled=false at zero users', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      githubEnabled: false,
      setupRequired: true,
      signupMode: 'setup',
      billingEnabled: false,
      emailConfigured: false,
    });
  });

  it('POST /setup creates the first admin as Owner of a workspace', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/setup', payload: admin });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe(admin.email);
    expect(body.workspace.id).toMatch(/^ws_/);
    workspaceId = body.workspace.id;

    // The setup response logs the admin in; reuse that cookie.
    adminCookie = cookieFromInject(res.headers['set-cookie']);
    expect(adminCookie.length).toBeGreaterThan(0);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: { cookie: adminCookie },
    });
    expect(list.statusCode).toBe(200);
    const owned = list.json().workspaces;
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({ id: workspaceId, role: 'owner' });
  });

  it('flips setupRequired to false and rejects a second /setup', async () => {
    const cfg = await app.inject({ method: 'GET', url: '/api/v1/auth/config' });
    expect(cfg.json().setupRequired).toBe(false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: { name: 'Eve', email: `eve-${id('usr')}@example.com`, password: 'supersecret3' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('email/password sign-in yields a session that resolves the user; no cookie → 401', async () => {
    const { headers } = await auth.api.signInEmail({
      body: { email: admin.email, password: admin.password },
      returnHeaders: true,
    });
    const cookie = cookieFromHeaders(headers);
    expect(cookie.length).toBeGreaterThan(0);

    const ok = await app.inject({ method: 'GET', url: '/api/v1/workspaces', headers: { cookie } });
    expect(ok.statusCode).toBe(200);

    const unauth = await app.inject({ method: 'GET', url: '/api/v1/workspaces' });
    expect(unauth.statusCode).toBe(401);
  });

  it('bootstrap is idempotent — no-op once a user exists', async () => {
    const seeded = await runBootstrap(db, sql, auth, {
      BOOTSTRAP_EMAIL: 'bootstrap@example.com',
      BOOTSTRAP_PASSWORD: 'supersecret4',
    });
    expect(seeded).toBe(false); // users already exist → skipped
  });

  it('Owner/Admin can invite; another user accepts and becomes a member', async () => {
    // Create the second user + session via better-auth server API.
    const signup = await auth.api.signUpEmail({
      body: { name: member.name, email: member.email, password: member.password },
      returnHeaders: true,
    });
    memberUserId = signup.response.user.id;
    memberCookie = cookieFromHeaders(signup.headers);

    const invite = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invites`,
      headers: { cookie: adminCookie },
      payload: { role: 'editor' },
    });
    expect(invite.statusCode).toBe(201);
    const token = invite.json().invite.token as string;

    const accept = await app.inject({
      method: 'POST',
      url: '/api/v1/invites/accept',
      headers: { cookie: memberCookie },
      payload: { token },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json()).toMatchObject({ workspaceId, role: 'editor' });

    const members = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/members`,
      headers: { cookie: adminCookie },
    });
    const roster = members.json().members as Array<{ userId: string; role: string }>;
    expect(roster.find((m) => m.userId === memberUserId)?.role).toBe('editor');
  });

  it('rejects an expired invite token (410)', async () => {
    const token = `tok_${id('inv')}`;
    await db.insert(invites).values({
      id: id('inv'),
      workspaceId,
      role: 'viewer',
      token,
      expiresAt: new Date(Date.now() - 1000), // already expired
      createdBy: memberUserId,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/invites/accept',
      headers: { cookie: memberCookie },
      payload: { token },
    });
    expect(res.statusCode).toBe(410);
  });

  it('a non-admin (Editor) cannot create an invite (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invites`,
      headers: { cookie: memberCookie },
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a non-member cannot see the workspace (404, existence hidden)', async () => {
    // Fresh user with no membership.
    const stranger = await auth.api.signUpEmail({
      body: { name: 'Guido', email: `guido-${id('usr')}@example.com`, password: 'supersecret5' },
      returnHeaders: true,
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}`,
      headers: { cookie: cookieFromHeaders(stranger.headers) },
    });
    expect(res.statusCode).toBe(404);
  });

  it('Viewer cannot delete the workspace (403) but Owner can (204)', async () => {
    // Demote the editor to viewer.
    const demote = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}/members/${memberUserId}`,
      headers: { cookie: adminCookie },
      payload: { role: 'viewer' },
    });
    expect(demote.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${workspaceId}`,
      headers: { cookie: memberCookie },
    });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${workspaceId}`,
      headers: { cookie: adminCookie },
    });
    expect(ok.statusCode).toBe(204);
  });
});
