import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import {
  billingAccounts,
  id,
  workspaceMembers,
  workspaces,
  type BillingAccount,
  type Workspace,
} from '../db/index.js';
import { insertWorkspaceWithOwner } from './workspaces.js';

/**
 * Account provisioning + resolution — the one place an account is born and the
 * helpers that map a user/deployment to its owning account.
 *
 * Self-host has a single implicit account; cloud has one per signup. Both create
 * it through {@link provisionAccountWithWorkspace}, so the "every workspace
 * belongs to an account" invariant holds for first-run setup and self-serve
 * signup alike (the seam the cloud package plugs into — no fork).
 */

/** A Drizzle transaction handle (the argument to `db.transaction`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Insert a bare account (limits null = unlimited) using an existing transaction. */
export async function insertAccount(tx: Tx, name: string): Promise<BillingAccount> {
  const [account] = await tx
    .insert(billingAccounts)
    .values({ id: id('acc'), name })
    .returning();
  return account as BillingAccount;
}

/**
 * Provision an account plus its first workspace + Owner membership atomically.
 * Used by first-run setup and (later) cloud signup. The user is created by the
 * caller (better-auth) and passed in as `ownerId`.
 */
export async function provisionAccountWithWorkspace(
  db: Db,
  ownerId: string,
  accountName: string,
  workspaceName: string,
): Promise<{ account: BillingAccount; workspace: Workspace }> {
  return db.transaction(async (tx) => {
    const account = await insertAccount(tx, accountName);
    const workspace = await insertWorkspaceWithOwner(tx, ownerId, workspaceName, account.id);
    return { account, workspace };
  });
}

/**
 * The owning account of a user — resolved from the account of any workspace the
 * user belongs to. Works for both self-host (one account) and cloud (the user's
 * own account). Returns null only for a user with no workspaces yet (which, post
 * first-run setup, should not happen for a workspace-creating caller).
 */
export async function accountIdForUser(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ accountId: workspaces.accountId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);
  return row?.accountId ?? null;
}

/** Load an account by id. */
export async function getAccount(db: Db, accountId: string): Promise<BillingAccount | null> {
  const [account] = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.id, accountId))
    .limit(1);
  return account ?? null;
}
