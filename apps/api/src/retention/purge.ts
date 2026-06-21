import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { billingAccounts, reports, workspaces } from '../db/index.js';

/**
 * Report retention purge (PRD "Report Retention").
 *
 * Deletes reports whose SERVER `created_at` is older than the retention window.
 * Retention keys on `created_at` (and never the agent-supplied `occurred_at`):
 * `occurred_at` is untrusted and could be backdated to evade — or forward-dated
 * to dodge — a purge. `report_metrics` rows cascade via their FK to `reports`.
 *
 * The window is resolved PER ACCOUNT: an account's own `retention_days` wins;
 * accounts that leave it null fall back to the deployment-wide
 * `globalRetentionDays` (env `RETENTION_DAYS`). A window of `0`/null on both
 * means "keep forever" — that account is skipped entirely, so a misconfigured or
 * default deployment can never destroy data.
 */

/** One day in milliseconds — the retention window unit. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The cutoff instant: reports created strictly before this are expired. Derived
 * from the injected `now` so callers/tests are fully deterministic.
 */
export function retentionCutoff(retentionDays: number, now: Date): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

/**
 * Delete every expired report across all accounts and return how many rows were
 * removed. Each account uses its effective window (own `retention_days`, else
 * `globalRetentionDays`); accounts with an effective window <= 0 are skipped.
 *
 * Pure of scheduling/locking concerns so it is unit/integration testable on its
 * own; the scheduler wraps it with the advisory lock.
 *
 * @param globalRetentionDays Deployment-wide default for accounts that leave
 *   their own `retention_days` null (env `RETENTION_DAYS`; 0 = keep forever).
 * @param now Injected clock (defaults to wall-clock) — pass a fixed Date in
 *   tests to make the cutoff exact.
 */
export async function purgeExpiredReports(
  db: Db,
  globalRetentionDays: number,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db
    .select({ id: billingAccounts.id, retentionDays: billingAccounts.retentionDays })
    .from(billingAccounts);

  let total = 0;
  for (const account of rows) {
    const effectiveDays = account.retentionDays ?? globalRetentionDays;
    // <= 0 (or null + global 0) → retention disabled for this account → skip.
    if (effectiveDays <= 0) continue;

    const cutoff = retentionCutoff(effectiveDays, now);
    const workspaceIds = db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.accountId, account.id));

    const deleted = await db
      .delete(reports)
      .where(and(inArray(reports.workspaceId, workspaceIds), lt(reports.createdAt, cutoff)))
      .returning({ id: reports.id });
    total += deleted.length;
  }
  return total;
}
