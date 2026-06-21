import { nanoid } from 'nanoid';
import type { Db } from '../db/index.js';
import { id, workspaceMembers, workspaces, type Workspace } from '../db/index.js';

/**
 * Workspace provisioning shared by `/setup`, headless bootstrap, and the
 * create-workspace endpoint. Keeping it in one place guarantees the "creator
 * becomes Owner" invariant holds everywhere a workspace is born.
 */

/** Lowercase, hyphenated, ascii-ish slug stem from a free-text name. */
function slugStem(name: string): string {
  const stem = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return stem || 'workspace';
}

/** A Drizzle transaction handle (the argument to `db.transaction`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Insert a workspace + its Owner membership using an existing transaction.
 * Exposed so callers that already hold a transaction (e.g. first-admin
 * provisioning under an advisory lock) can compose this atomically.
 */
export async function insertWorkspaceWithOwner(
  tx: Tx,
  ownerId: string,
  name: string,
  accountId: string,
): Promise<Workspace> {
  const workspaceId = id('ws');
  const slug = `${slugStem(name)}-${nanoid(6).toLowerCase()}`;

  const [workspace] = await tx
    .insert(workspaces)
    .values({ id: workspaceId, accountId, name, slug })
    .returning();
  await tx.insert(workspaceMembers).values({ workspaceId, userId: ownerId, role: 'owner' });
  return workspace as Workspace;
}

/**
 * Create a workspace under `accountId` and make `ownerId` its Owner, atomically.
 * The slug is the name's stem plus a short random suffix to satisfy the unique
 * constraint without a retry loop.
 */
export async function createWorkspaceWithOwner(
  db: Db,
  ownerId: string,
  name: string,
  accountId: string,
): Promise<Workspace> {
  return db.transaction((tx) => insertWorkspaceWithOwner(tx, ownerId, name, accountId));
}
