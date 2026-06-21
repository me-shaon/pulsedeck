import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth, type Auth, type AuthEnv } from '../src/auth/auth.js';
import { buildRuntimeConfig } from '../src/config/runtime.js';
import { createDrizzle, id, type Db } from '../src/db/index.js';
import { provisionAccountWithWorkspace } from '../src/services/accounts.js';
import type { EmailMessage, EmailPort } from '../src/services/email.js';
import { runMigrations } from '../src/migrate.js';
import { buildServer } from '../src/server.js';
import type { Sql } from '../src/db.js';

/**
 * Cloud-readiness extension seams: the signup-mode gate on public sign-up and
 * the transactional EmailPort. Gated on DATABASE_URL (skipped otherwise).
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

describeIfDb('cloud-readiness seams (integration)', () => {
  let sql: Sql;
  let db: Db;
  let auth: Auth;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sql);
    await runMigrations(sql);
    await sql`TRUNCATE users, accounts, workspaces, workspace_members, invites, account, session, verification RESTART IDENTITY CASCADE`;
    auth = createAuth(db, AUTH_ENV);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('blocks public POST /api/auth/sign-up in setup mode (OSS default) → 403', async () => {
    const app = buildServer({ sql, env: AUTH_ENV, auth }); // default runtime = self-host/setup
    await app.ready();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        payload: { name: 'X', email: `x-${id('usr')}@example.com`, password: 'supersecret1' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/signup mode: setup/i);
    } finally {
      await app.close();
    }
  });

  it('allows public POST /api/auth/sign-up in open mode (cloud) → not 403', async () => {
    const runtime = buildRuntimeConfig({ SIGNUP_MODE: 'open' });
    const app = buildServer({ sql, env: AUTH_ENV, auth, runtime });
    await app.ready();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        payload: { name: 'Y', email: `y-${id('usr')}@example.com`, password: 'supersecret1' },
      });
      expect(res.statusCode).not.toBe(403);
    } finally {
      await app.close();
    }
  });

  it('hands a workspace invite with an email to the EmailPort', async () => {
    const sent: EmailMessage[] = [];
    const fakeEmail: EmailPort = {
      async send(message) {
        sent.push(message);
      },
    };
    const app = buildServer({ sql, env: AUTH_ENV, auth, email: fakeEmail });
    await app.ready();
    try {
      // Provision an owner + account + workspace directly (independent of the
      // self-disabling /setup path, which earlier tests may have consumed).
      const { response, headers } = await auth.api.signUpEmail({
        body: { name: 'Owner', email: `owner-${id('usr')}@example.com`, password: 'supersecret1' },
        returnHeaders: true,
      });
      const { workspace } = await provisionAccountWithWorkspace(
        db,
        response.user.id,
        "Owner's Account",
        "Owner's Workspace",
      );
      const workspaceId = workspace.id;
      const cookie = cookieFromInject(headers.getSetCookie());

      const invitee = `invitee-${id('usr')}@example.com`;
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/invites`,
        headers: { cookie },
        payload: { role: 'editor', email: invitee },
      });
      expect(res.statusCode).toBe(201);
      // The URL is still returned (OSS delivery channel)…
      expect(res.json().invite.inviteUrl).toContain('/invite/');
      // …and the port received the message (cloud would actually deliver it).
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: invitee, template: 'workspace-invite' });
      expect(sent[0].data).toMatchObject({ role: 'editor', workspaceId });
    } finally {
      await app.close();
    }
  });
});
