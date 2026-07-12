import { and, countDistinct, eq, inArray, sql } from 'drizzle-orm';
import type { Db, DbOrTx, Tx } from '../db/index.js';
import { billingAccounts, webhooks, workspaceMembers, workspaces } from '../db/index.js';

/**
 * Account limit enforcement — the single seam between a plan's quotas and the
 * app. Limits live as nullable columns on the account (`null` = unlimited), so
 * OSS (where every account is unlimited) hits a pure no-op. The cloud sets the
 * columns from the subscription; this code just reads and enforces them.
 */

/** Per-account limits; `null` on any field means "no limit". */
export interface AccountLimits {
  retentionDays: number | null;
  maxSeats: number | null;
  maxWorkspaces: number | null;
  maxWebhooks: number | null;
}

/** Which quota was hit — lets the web map the error to the right upsell. */
export type LimitKind = 'seats' | 'workspaces' | 'webhooks';

/**
 * Raised when an account action would exceed its plan. Carries `statusCode` 402
 * so the global error handler surfaces it as Payment Required with the message
 * (an "upgrade" signal), plus a machine-readable `limit` kind.
 */
export class LimitExceededError extends Error {
  readonly statusCode = 402;
  constructor(
    readonly limit: LimitKind,
    message: string,
  ) {
    super(message);
    this.name = 'LimitExceededError';
  }
}

/** Read an account's limits. Missing account → all-unlimited (defensive). */
export async function getAccountLimits(db: DbOrTx, accountId: string): Promise<AccountLimits> {
  const [row] = await db
    .select({
      retentionDays: billingAccounts.retentionDays,
      maxSeats: billingAccounts.maxSeats,
      maxWorkspaces: billingAccounts.maxWorkspaces,
      maxWebhooks: billingAccounts.maxWebhooks,
    })
    .from(billingAccounts)
    .where(eq(billingAccounts.id, accountId))
    .limit(1);
  return {
    retentionDays: row?.retentionDays ?? null,
    maxSeats: row?.maxSeats ?? null,
    maxWorkspaces: row?.maxWorkspaces ?? null,
    maxWebhooks: row?.maxWebhooks ?? null,
  };
}

/** Number of workspaces under an account. */
export async function countWorkspaces(db: DbOrTx, accountId: string): Promise<number> {
  const [row] = await db
    .select({ value: countDistinct(workspaces.id) })
    .from(workspaces)
    .where(eq(workspaces.accountId, accountId));
  return Number(row?.value ?? 0);
}

/** Number of distinct member users across all of an account's workspaces (= seats). */
export async function countSeats(db: DbOrTx, accountId: string): Promise<number> {
  const [row] = await db
    .select({ value: countDistinct(workspaceMembers.userId) })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaces.accountId, accountId));
  return Number(row?.value ?? 0);
}

/** Throw {@link LimitExceededError} if adding a workspace would exceed the plan. */
export async function assertCanAddWorkspace(db: DbOrTx, accountId: string): Promise<void> {
  const { maxWorkspaces } = await getAccountLimits(db, accountId);
  if (maxWorkspaces == null) return; // unlimited
  if ((await countWorkspaces(db, accountId)) >= maxWorkspaces) {
    throw new LimitExceededError(
      'workspaces',
      `Workspace limit reached (${maxWorkspaces}). Upgrade your plan to add more.`,
    );
  }
}

/**
 * Throw {@link LimitExceededError} if adding a seat would exceed the plan.
 * `existingUserId` (an already-counted member, e.g. an invite re-accept) does
 * not consume a new seat, so it's exempt from the ceiling check.
 */
export async function assertCanAddSeat(
  db: DbOrTx,
  accountId: string,
  existingUserId?: string,
): Promise<void> {
  const { maxSeats } = await getAccountLimits(db, accountId);
  if (maxSeats == null) return; // unlimited
  if (existingUserId && (await isAccountMember(db, accountId, existingUserId))) return;
  if ((await countSeats(db, accountId)) >= maxSeats) {
    throw new LimitExceededError(
      'seats',
      `Seat limit reached (${maxSeats}). Upgrade your plan to add more members.`,
    );
  }
}

/** The owning account id for a workspace, or null if the workspace is unknown. */
export async function accountIdForWorkspace(
  db: DbOrTx,
  workspaceId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ accountId: workspaces.accountId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.accountId ?? null;
}

/** Number of webhooks across all of an account's workspaces. */
export async function countWebhooks(db: DbOrTx, accountId: string): Promise<number> {
  const wsRows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.accountId, accountId));
  const ids = wsRows.map((r) => r.id);
  if (ids.length === 0) return 0;
  const [row] = await db
    .select({ value: countDistinct(webhooks.id) })
    .from(webhooks)
    .where(inArray(webhooks.workspaceId, ids));
  return Number(row?.value ?? 0);
}

/**
 * Throw {@link LimitExceededError} if adding a webhook to `workspaceId` would
 * exceed the owning account's plan. `null` limit (the OSS default) is a no-op.
 */
export async function assertCanAddWebhook(db: DbOrTx, workspaceId: string): Promise<void> {
  const accountId = await accountIdForWorkspace(db, workspaceId);
  if (!accountId) return; // unknown workspace — the route's RBAC gate handles existence
  const { maxWebhooks } = await getAccountLimits(db, accountId);
  if (maxWebhooks == null) return; // unlimited
  if ((await countWebhooks(db, accountId)) >= maxWebhooks) {
    throw new LimitExceededError(
      'webhooks',
      `Webhook limit reached (${maxWebhooks}). Upgrade your plan to add more.`,
    );
  }
}

/**
 * Advisory-lock class for per-account quota enforcement. Arbitrary but stable;
 * paired with `hashtext(accountId)` as the second key so the lock namespace is
 * isolated from any other advisory lock in the system.
 */
const ACCOUNT_QUOTA_LOCK_CLASS = 0x5044; // "PD"

/**
 * Run `fn` inside a transaction that first takes a per-account advisory lock, so
 * a quota check and the insert it guards are serialized against every other
 * create for the same account. Without this the check (count) and the insert are
 * two unlocked round-trips: N concurrent creates each read `count = limit-1`,
 * all pass, and all insert — overshooting the quota (TOCTOU). The lock is
 * transaction-scoped (`pg_advisory_xact_lock`), auto-released on commit/rollback;
 * keyed by `hashtext(accountId)` so distinct accounts never contend.
 */
export async function withAccountQuotaLock<T>(
  db: Db,
  accountId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${ACCOUNT_QUOTA_LOCK_CLASS}, hashtext(${accountId}))`,
    );
    return fn(tx);
  });
}

/** Whether a user already holds membership in some workspace of the account. */
async function isAccountMember(db: DbOrTx, accountId: string, userId: string): Promise<boolean> {
  const [match] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaces.accountId, accountId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return Boolean(match);
}
