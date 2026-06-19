import { count, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { users, type Workspace } from '../db/index.js';
import type { Sql } from '../db.js';
import { createWorkspaceWithOwner } from '../services/workspaces.js';
import type { Auth } from './auth.js';

/** Advisory-lock key serializing first-admin provisioning across requests/replicas. */
const ADMIN_PROVISION_LOCK = 4242;

/** Thrown when provisioning loses the zero-users race (another admin already exists). */
export class SetupAlreadyCompletedError extends Error {
  constructor() {
    super('Setup has already been completed');
    this.name = 'SetupAlreadyCompletedError';
  }
}

/**
 * First-run onboarding + headless bootstrap.
 *
 * "Setup required" is defined purely as "there are zero users". The first admin
 * is created through better-auth (so the password is hashed in the `account`
 * table), then given an Owner workspace. Once any user exists the condition is
 * permanently false, so `/setup` self-disables and bootstrap is a no-op.
 */

/** Count of user rows. */
export async function countUsers(db: Db): Promise<number> {
  const [row] = await db.select({ value: count() }).from(users);
  return Number(row?.value ?? 0);
}

/** Setup is required exactly while no user exists. */
export async function isSetupRequired(db: Db): Promise<boolean> {
  return (await countUsers(db)) === 0;
}

export interface AdminInput {
  name: string;
  email: string;
  password: string;
}

export interface ProvisionedAdmin {
  userId: string;
  workspace: Workspace;
  /** Headers from better-auth sign-up (carries the session Set-Cookie). */
  headers: Headers;
}

/**
 * Create the first admin user via better-auth and an initial Owner workspace.
 * Returns the better-auth response headers so the caller can forward the
 * session cookie (the new admin is signed in immediately).
 *
 * Concurrency-safe: a Postgres advisory lock serializes provisioning and the
 * zero-users check is re-run while holding it, so two concurrent `/setup` calls
 * (or replicas booting at once) can never both create an admin — the loser gets
 * {@link SetupAlreadyCompletedError}. If workspace creation fails after the
 * better-auth user is committed (on its own connection), the orphan user is
 * deleted so setup remains available rather than permanently self-disabling.
 */
export async function provisionFirstAdmin(
  db: Db,
  sql: Sql,
  auth: Auth,
  input: AdminInput,
): Promise<ProvisionedAdmin> {
  // Hold a session-level advisory lock on a dedicated connection (NOT a
  // transaction — better-auth manages its own DB access and deadlocks if nested
  // inside one). This serializes provisioning so the zero-users re-check below
  // is authoritative: a concurrent loser sees a user and gets the typed error.
  const conn = await sql.reserve();
  let createdUserId: string | undefined;
  try {
    await conn`SELECT pg_advisory_lock(${ADMIN_PROVISION_LOCK})`;

    if ((await countUsers(db)) > 0) throw new SetupAlreadyCompletedError();

    const { response, headers } = await auth.api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
      returnHeaders: true,
    });
    createdUserId = response.user.id;

    const workspace = await createWorkspaceWithOwner(
      db,
      createdUserId,
      `${input.name}'s Workspace`,
    );
    return { userId: createdUserId, workspace, headers };
  } catch (err) {
    // If workspace creation failed after better-auth committed the user, remove
    // the orphan so the zero-users condition (and /setup) is restored rather
    // than permanently self-disabling. Skip when the guard tripped (no user).
    if (createdUserId && !(err instanceof SetupAlreadyCompletedError)) {
      await db.delete(users).where(eq(users.id, createdUserId));
    }
    throw err;
  } finally {
    await conn`SELECT pg_advisory_unlock(${ADMIN_PROVISION_LOCK})`.catch(() => {});
    conn.release();
  }
}

/**
 * Headless bootstrap: when `BOOTSTRAP_EMAIL`/`BOOTSTRAP_PASSWORD` are set and
 * there are zero users, seed the admin + workspace on startup so `/setup` is
 * effectively skipped. Idempotent: the zero-users guard means a restart (which
 * now has a user) does nothing, so the admin is never double-seeded.
 */
export async function runBootstrap(
  db: Db,
  sql: Sql,
  auth: Auth,
  env: { BOOTSTRAP_EMAIL?: string; BOOTSTRAP_PASSWORD?: string },
): Promise<boolean> {
  if (!env.BOOTSTRAP_EMAIL || !env.BOOTSTRAP_PASSWORD) return false;
  if (!(await isSetupRequired(db))) return false;

  try {
    await provisionFirstAdmin(db, sql, auth, {
      name: 'Admin',
      email: env.BOOTSTRAP_EMAIL,
      password: env.BOOTSTRAP_PASSWORD,
    });
    return true;
  } catch (err) {
    // Another replica won the provisioning race — expected, not a failure, so
    // this replica boots normally. Any OTHER error (e.g. invalid bootstrap
    // credentials) is a real misconfiguration and is surfaced to crash startup.
    if (err instanceof SetupAlreadyCompletedError) return false;
    throw err;
  }
}
