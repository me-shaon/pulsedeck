import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/index.js';
import type { Sql } from '../src/db.js';
import { createRetentionRunner, retentionCutoff } from '../src/retention/index.js';

/**
 * Pure unit tests for the retention runner — no database. They exercise the
 * scheduler/lock control flow with a fake `sql` (advisory lock returns true or
 * false) and an injected `purge` spy, so the single-run guard and the
 * disabled-by-default behavior are verified without Postgres.
 *
 * The DB-backed delete semantics (cutoff on `created_at`, metric cascade, exact
 * count) are covered in `retention.integration.test.ts`.
 */

const stubDb = {} as Db;

/**
 * A fake postgres-js client whose reserved connection answers
 * `pg_try_advisory_lock` with the configured `locked` value. Records unlock +
 * release so we can assert the lock is always cleaned up.
 */
function makeFakeSql(locked: boolean) {
  const calls = { unlock: 0, release: 0 };
  const conn = ((strings: TemplateStringsArray) => {
    const text = strings.join('');
    if (text.includes('pg_try_advisory_lock')) return Promise.resolve([{ locked }]);
    if (text.includes('pg_advisory_unlock')) {
      calls.unlock += 1;
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }) as unknown as Awaited<ReturnType<Sql['reserve']>>;
  (conn as unknown as { release: () => void }).release = () => {
    calls.release += 1;
  };
  const sql = { reserve: () => Promise.resolve(conn) } as unknown as Sql;
  return { sql, calls };
}

describe('retentionCutoff', () => {
  it('subtracts the window in days from now', () => {
    const now = new Date('2026-06-20T00:00:00.000Z');
    expect(retentionCutoff(7, now).toISOString()).toBe('2026-06-13T00:00:00.000Z');
  });
});

describe('createRetentionRunner (unit)', () => {
  it('is disabled and never purges when retentionDays = 0', async () => {
    const purge = vi.fn(async () => 0);
    const { sql, calls } = makeFakeSql(true);
    const runner = createRetentionRunner({
      db: stubDb,
      sql,
      retentionDays: 0,
      sweepIntervalMs: 1000,
      purge,
    });

    expect(runner.getStatus().enabled).toBe(false);

    // start() must NOT schedule destructive work; runOnce() is a guaranteed no-op.
    runner.start();
    expect(runner.getStatus().scheduled).toBe(false);

    const outcome = await runner.runOnce();
    expect(outcome).toBe('skipped');
    expect(purge).not.toHaveBeenCalled();
    expect(calls.release).toBe(0); // never even reserved a connection
    runner.stop();
  });

  it('acquires the lock, purges, releases, and records status on success', async () => {
    const now = new Date('2026-06-20T12:00:00.000Z');
    const purge = vi.fn(async () => 5);
    const { sql, calls } = makeFakeSql(true);
    const runner = createRetentionRunner({
      db: stubDb,
      sql,
      retentionDays: 30,
      sweepIntervalMs: 1000,
      now: () => now,
      purge,
    });

    const outcome = await runner.runOnce();
    expect(outcome).toBe('success');
    expect(purge).toHaveBeenCalledWith(stubDb, 30, now);
    expect(calls.unlock).toBe(1); // lock released
    expect(calls.release).toBe(1); // connection released

    const status = runner.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.lastOutcome).toBe('success');
    expect(status.lastDeletedCount).toBe(5);
    expect(status.runs).toBe(1);
    expect(status.attempts).toBe(1);
    expect(status.lastRunAt).not.toBeNull();
    expect(status.lastError).toBeNull();
  });

  it('short-circuits to skipped (no purge) when the advisory lock is held elsewhere', async () => {
    const purge = vi.fn(async () => 99);
    const { sql, calls } = makeFakeSql(false); // pg_try_advisory_lock → false
    const runner = createRetentionRunner({
      db: stubDb,
      sql,
      retentionDays: 30,
      sweepIntervalMs: 1000,
      purge,
    });

    const outcome = await runner.runOnce();
    expect(outcome).toBe('skipped');
    expect(purge).not.toHaveBeenCalled(); // the loser must NOT delete
    expect(calls.unlock).toBe(0); // nothing to unlock (never acquired)
    expect(calls.release).toBe(1); // but the connection is still released

    const status = runner.getStatus();
    expect(status.attempts).toBe(1);
    expect(status.runs).toBe(0); // no actual purge ran
    expect(status.lastOutcome).toBe('skipped');
  });

  it('records an error outcome (and still releases the lock) when purge throws', async () => {
    const purge = vi.fn(async () => {
      throw new Error('boom');
    });
    const { sql, calls } = makeFakeSql(true);
    const runner = createRetentionRunner({
      db: stubDb,
      sql,
      retentionDays: 30,
      sweepIntervalMs: 1000,
      purge,
    });

    const outcome = await runner.runOnce();
    expect(outcome).toBe('error');
    expect(calls.unlock).toBe(1); // released even on failure
    expect(calls.release).toBe(1);

    const status = runner.getStatus();
    expect(status.lastOutcome).toBe('error');
    expect(status.lastError).toBe('boom');
    expect(status.runs).toBe(0);
  });
});
