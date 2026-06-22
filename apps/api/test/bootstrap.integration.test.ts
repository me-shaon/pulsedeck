import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { createAuth, type Auth, type AuthEnv } from '../src/auth/auth.js';
import { countUsers, isSetupRequired, runBootstrap } from '../src/auth/setup.js';
import { createDrizzle, users, workspaceMembers, type Db } from '../src/db/index.js';
import { runMigrations } from '../src/migrate.js';
import type { Sql } from '../src/db.js';

/**
 * Headless bootstrap, on a clean DB: seeds the admin + Owner workspace exactly
 * once when BOOTSTRAP_* is set and there are zero users, and is a no-op on the
 * simulated "restart" (idempotency).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const AUTH_ENV: AuthEnv = { AUTH_SECRET: 'test-secret-test-secret-test-secret-123' };
const BOOTSTRAP = {
  BOOTSTRAP_EMAIL: `bootstrap-${Date.now()}@example.com`,
  BOOTSTRAP_PASSWORD: 'supersecretbootstrap',
};

describeIfDb('headless bootstrap (integration)', () => {
  let sql: Sql;
  let db: Db;
  let auth: Auth;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sql);
    await runMigrations(sql);
    await sql`TRUNCATE users, billing_accounts, workspaces, workspace_members, invites, account, session, verification RESTART IDENTITY CASCADE`;
    auth = createAuth(db, AUTH_ENV);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('seeds the admin + Owner workspace on first run', async () => {
    expect(await isSetupRequired(db)).toBe(true);

    const seeded = await runBootstrap(db, sql, auth, BOOTSTRAP);
    expect(seeded).toBe(true);

    expect(await countUsers(db)).toBe(1);
    const [user] = await db.select().from(users).where(eq(users.email, BOOTSTRAP.BOOTSTRAP_EMAIL));
    expect(user).toBeTruthy();

    const memberships = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user!.id));
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.role).toBe('owner');
  });

  it('is a no-op on restart (does not double-seed)', async () => {
    const seededAgain = await runBootstrap(db, sql, auth, BOOTSTRAP);
    expect(seededAgain).toBe(false);
    expect(await countUsers(db)).toBe(1);
  });

  it('does nothing when BOOTSTRAP_* is unset', async () => {
    const res = await runBootstrap(db, sql, auth, {});
    expect(res).toBe(false);
  });
});
