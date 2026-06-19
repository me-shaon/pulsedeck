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

/**
 * Create a workspace and make `ownerId` its Owner, atomically. The slug is the
 * name's stem plus a short random suffix to satisfy the unique constraint
 * without a retry loop.
 */
export async function createWorkspaceWithOwner(
  db: Db,
  ownerId: string,
  name: string,
): Promise<Workspace> {
  const workspaceId = id('ws');
  const slug = `${slugStem(name)}-${nanoid(6).toLowerCase()}`;

  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({ id: workspaceId, name, slug })
      .returning();

    await tx.insert(workspaceMembers).values({ workspaceId, userId: ownerId, role: 'owner' });

    return workspace as Workspace;
  });
}
