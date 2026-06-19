import { count } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { users, type Workspace } from '../db/index.js';
import { createWorkspaceWithOwner } from '../services/workspaces.js';
import type { Auth } from './auth.js';

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
 * Callers MUST gate this on {@link isSetupRequired}; it does not re-check.
 */
export async function provisionFirstAdmin(
  db: Db,
  auth: Auth,
  input: AdminInput,
): Promise<ProvisionedAdmin> {
  const { response, headers } = await auth.api.signUpEmail({
    body: { name: input.name, email: input.email, password: input.password },
    returnHeaders: true,
  });

  const userId = response.user.id;
  const workspace = await createWorkspaceWithOwner(db, userId, `${input.name}'s Workspace`);

  return { userId, workspace, headers };
}

/**
 * Headless bootstrap: when `BOOTSTRAP_EMAIL`/`BOOTSTRAP_PASSWORD` are set and
 * there are zero users, seed the admin + workspace on startup so `/setup` is
 * effectively skipped. Idempotent: the zero-users guard means a restart (which
 * now has a user) does nothing, so the admin is never double-seeded.
 */
export async function runBootstrap(
  db: Db,
  auth: Auth,
  env: { BOOTSTRAP_EMAIL?: string; BOOTSTRAP_PASSWORD?: string },
): Promise<boolean> {
  if (!env.BOOTSTRAP_EMAIL || !env.BOOTSTRAP_PASSWORD) return false;
  if (!(await isSetupRequired(db))) return false;

  await provisionFirstAdmin(db, auth, {
    name: 'Admin',
    email: env.BOOTSTRAP_EMAIL,
    password: env.BOOTSTRAP_PASSWORD,
  });
  return true;
}
