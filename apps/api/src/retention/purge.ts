import { lt } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { reports } from '../db/index.js';

/**
 * Report retention purge (PRD "Report Retention").
 *
 * Deletes reports whose SERVER `created_at` is older than the retention window.
 * Retention keys on `created_at` (and never the agent-supplied `occurred_at`):
 * `occurred_at` is untrusted and could be backdated to evade — or forward-dated
 * to dodge — a purge. `report_metrics` rows cascade via their FK to `reports`.
 *
 * `RETENTION_DAYS = 0` (the default) means "keep forever": the function returns
 * 0 without issuing any DELETE, so a misconfigured or default deployment can
 * never destroy data.
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
 * Delete every report older than the retention window and return how many rows
 * were removed. Pure of scheduling/locking concerns so it is unit/integration
 * testable on its own; the scheduler wraps it with the advisory lock.
 *
 * @param now Injected clock (defaults to wall-clock) — pass a fixed Date in
 *   tests to make the cutoff exact.
 */
export async function purgeExpiredReports(
  db: Db,
  retentionDays: number,
  now: Date = new Date(),
): Promise<number> {
  // 0 (or any non-positive) → retention disabled → delete NOTHING.
  if (retentionDays <= 0) return 0;

  const cutoff = retentionCutoff(retentionDays, now);
  // Parameterized DELETE keyed on server `created_at`. `.returning` the id makes
  // the deleted-row count exact and driver-agnostic; reports are append-only so
  // expired sets are bounded by the sweep interval, not unbounded history.
  const deleted = await db
    .delete(reports)
    .where(lt(reports.createdAt, cutoff))
    .returning({ id: reports.id });
  return deleted.length;
}
