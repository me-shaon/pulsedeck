import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth, type Auth, type AuthEnv } from '../src/auth/auth.js';
import { createDrizzle, id, type Db } from '../src/db/index.js';
import type { Sql } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { buildServer } from '../src/server.js';

/**
 * Membership-management authorization (security finding H1): a caller may only
 * act on members at or below their own rank. An Admin holds `members:manage` but
 * must not be able to demote or remove an Owner while another owner exists.
 *
 * Gated on DATABASE_URL (skipped otherwise); mirrors the shared integration
 * harness (postgres-js, migrate, truncate, build via `buildServer`).
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

describeIfDb('workspace members: rank-ceiling authorization (integration)', () => {
  let sql: Sql;
  let db: Db;
  let auth: Auth;
  let app: FastifyInstance;

  let workspaceId: string;
  let owner1Cookie: string; // first admin from /setup (Owner)
  let owner2Id: string;
  let adminCookie: string; // an Admin member — the would-be attacker
  let editorId: string;

  // Add a freshly signed-up user to the workspace at `role` (driven through the
  // real invite/accept flow as Owner). Returns the new user's id + session cookie.
  async function addMember(
    role: 'owner' | 'admin' | 'editor' | 'viewer',
    label: string,
  ): Promise<{ userId: string; cookie: string }> {
    const { response, headers } = await auth.api.signUpEmail({
      body: {
        name: label,
        email: `${label}-${id('usr')}@example.com`,
        password: 'supersecret1',
      },
      returnHeaders: true,
    });
    const cookie = cookieFromHeaders(headers);
    const invite = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invites`,
      headers: { cookie: owner1Cookie },
      payload: { role },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/invites/accept',
      headers: { cookie },
      payload: { token: invite.json().invite.token },
    });
    return { userId: response.user.id, cookie };
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sql);
    await runMigrations(sql);
    await sql`TRUNCATE users, billing_accounts, workspaces, workspace_members, invites, sources,
      source_registration_tokens, source_categories, source_streams, categories,
      streams, reports, account, session, verification RESTART IDENTITY CASCADE`;

    auth = createAuth(db, AUTH_ENV);
    app = buildServer({ sql, env: AUTH_ENV, auth });
    await app.ready();

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: {
        name: 'Owner One',
        email: `owner1-${id('usr')}@example.com`,
        password: 'supersecret1',
      },
    });
    workspaceId = setup.json().workspace.id;
    owner1Cookie = cookieFromInject(setup.headers['set-cookie']);

    owner2Id = (await addMember('owner', 'owner2')).userId;
    adminCookie = (await addMember('admin', 'adminmember')).cookie;
    editorId = (await addMember('editor', 'editormember')).userId;
  });

  afterAll(async () => {
    await app?.close();
    await sql?.end({ timeout: 5 });
  });

  const patchRole = (cookie: string, userId: string, role: string) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}/members/${userId}`,
      headers: { cookie },
      payload: { role },
    });
  const removeMember = (cookie: string, userId: string) =>
    app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${workspaceId}/members/${userId}`,
      headers: { cookie },
    });

  it('Admin CANNOT demote an Owner (403)', async () => {
    const res = await patchRole(adminCookie, owner2Id, 'viewer');
    expect(res.statusCode).toBe(403);
  });

  it('Admin CANNOT remove an Owner (403)', async () => {
    const res = await removeMember(adminCookie, owner2Id);
    expect(res.statusCode).toBe(403);
  });

  it('Admin CAN act on a lower-ranked member (200)', async () => {
    const res = await patchRole(adminCookie, editorId, 'viewer');
    expect(res.statusCode).toBe(200);
  });

  it('Owner CAN change another Owner (peer rank, 200)', async () => {
    const demote = await patchRole(owner1Cookie, owner2Id, 'admin');
    expect(demote.statusCode).toBe(200);
    const restore = await patchRole(owner1Cookie, owner2Id, 'owner');
    expect(restore.statusCode).toBe(200);
  });

  it('still blocks demoting the last owner (400, not 403)', async () => {
    // Demote owner2 so owner1 is the sole owner, then owner1 cannot self-demote.
    expect((await patchRole(owner1Cookie, owner2Id, 'admin')).statusCode).toBe(200);
    const setup = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/members`,
      headers: { cookie: owner1Cookie },
    });
    const owner1Id = setup.json().members.find((m: { role: string }) => m.role === 'owner').userId;
    const res = await patchRole(owner1Cookie, owner1Id, 'admin');
    expect(res.statusCode).toBe(400);
    // restore for any later tests
    await patchRole(owner1Cookie, owner2Id, 'owner');
  });
});
