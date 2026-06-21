import { and, countDistinct, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { billingAccounts, workspaceMembers, workspaces } from '../db/index.js';

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
}

/** Which quota was hit — lets the web map the error to the right upsell. */
export type LimitKind = 'seats' | 'workspaces';

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
export async function getAccountLimits(db: Db, accountId: string): Promise<AccountLimits> {
  const [row] = await db
    .select({
      retentionDays: billingAccounts.retentionDays,
      maxSeats: billingAccounts.maxSeats,
      maxWorkspaces: billingAccounts.maxWorkspaces,
    })
    .from(billingAccounts)
    .where(eq(billingAccounts.id, accountId))
    .limit(1);
  return {
    retentionDays: row?.retentionDays ?? null,
    maxSeats: row?.maxSeats ?? null,
    maxWorkspaces: row?.maxWorkspaces ?? null,
  };
}

/** Number of workspaces under an account. */
export async function countWorkspaces(db: Db, accountId: string): Promise<number> {
  const [row] = await db
    .select({ value: countDistinct(workspaces.id) })
    .from(workspaces)
    .where(eq(workspaces.accountId, accountId));
  return Number(row?.value ?? 0);
}

/** Number of distinct member users across all of an account's workspaces (= seats). */
export async function countSeats(db: Db, accountId: string): Promise<number> {
  const [row] = await db
    .select({ value: countDistinct(workspaceMembers.userId) })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaces.accountId, accountId));
  return Number(row?.value ?? 0);
}

/** Throw {@link LimitExceededError} if adding a workspace would exceed the plan. */
export async function assertCanAddWorkspace(db: Db, accountId: string): Promise<void> {
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
  db: Db,
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

/** Whether a user already holds membership in some workspace of the account. */
async function isAccountMember(db: Db, accountId: string, userId: string): Promise<boolean> {
  const [match] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaces.accountId, accountId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return Boolean(match);
}
