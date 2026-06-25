import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth, type Auth, type AuthEnv } from '../src/auth/auth.js';
import { buildRuntimeConfig } from '../src/config/runtime.js';
import { createDrizzle, type Db } from '../src/db/index.js';
import type { Sql } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { buildServer } from '../src/server.js';

/**
 * Brute-force throttling on the auth endpoints (security finding H2). The
 * sensitive paths (sign-in/up, password reset) must 429 once the per-IP limit is
 * exceeded; high-frequency non-sensitive paths (get-session) must not be limited.
 *
 * Gated on DATABASE_URL; uses a tiny AUTH_RATE_LIMIT so the cap is hit in a few
 * requests. In-memory store (no Redis) — the limiter behaves the same, just per
 * node.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const AUTH_ENV: AuthEnv = {
  AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
  BETTER_AUTH_URL: 'http://localhost:3001',
};

describeIfDb('auth endpoints: brute-force rate limiting (integration)', () => {
  let sql: Sql;
  let db: Db;
  let auth: Auth;
  let app: FastifyInstance;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sql);
    await runMigrations(sql);
    await sql`TRUNCATE users, billing_accounts, workspaces, workspace_members, invites, sources,
      source_registration_tokens, source_categories, source_streams, categories,
      streams, reports, account, session, verification RESTART IDENTITY CASCADE`;

    auth = createAuth(db, AUTH_ENV);
    // Tiny limit so the cap is reached in a handful of requests.
    app = buildServer({
      sql,
      env: AUTH_ENV,
      auth,
      runtime: buildRuntimeConfig({ AUTH_RATE_LIMIT: 3 }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await sql?.end({ timeout: 5 });
  });

  it('throttles repeated sign-in attempts (429 once the limit is exceeded)', async () => {
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        payload: { email: 'nobody@example.com', password: 'wrong-password-1' },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await attempt()).statusCode);

    // First 3 are processed (401 bad creds), the rest are rate limited.
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it('does NOT rate limit the high-frequency get-session path', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/auth/get-session' });
      statuses.push(res.statusCode);
    }
    expect(statuses.some((s) => s === 429)).toBe(false);
  });
});
