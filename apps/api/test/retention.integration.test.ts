import { sql as drizzleSql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  categories,
  createDrizzle,
  id,
  reportMetrics,
  reports,
  sources,
  streams,
  workspaces,
  type Db,
} from '../src/db/index.js';
import type { Sql } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import {
  createRetentionRunner,
  purgeExpiredReports,
  RETENTION_PURGE_LOCK,
} from '../src/retention/index.js';
import { seedAccount } from './helpers.js';

/**
 * Phase 11 retention purge — DB-backed (gated on DATABASE_URL; skipped
 * otherwise). Mirrors the Phase 5/6 harness: postgres-js, migrate, truncate,
 * direct seeding. Reports are inserted then their server `created_at` is updated
 * to a past instant (the column defaults to now()), so the cutoff is exercised
 * deterministically.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('retention purge (integration)', () => {
  let sql: Sql;
  let db: Db;
  let workspaceId: string;
  let streamId: string;
  let sourceId: string;

  /** Insert a report, then force its server `created_at` to `createdAt`. */
  async function seedReportAt(createdAt: Date): Promise<string> {
    const rid = id('rpt');
    await db.insert(reports).values({
      id: rid,
      streamId,
      workspaceId,
      sourceId,
      idempotencyKey: rid,
      title: 'retention probe',
      occurredAt: createdAt,
      receivedAt: createdAt,
      blocks: [],
      searchVector: drizzleSql`to_tsvector('english', 'retention probe')`,
    });
    await sql`UPDATE reports SET created_at = ${createdAt.toISOString()} WHERE id = ${rid}`;
    return rid;
  }

  async function countReports(): Promise<number> {
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM reports`;
    return row.n;
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sql);
    await runMigrations(sql);
    await sql`TRUNCATE users, accounts, workspaces, workspace_members, invites, sources,
      source_registration_tokens, source_categories, source_streams, categories,
      streams, reports, report_metrics, account, session, verification
      RESTART IDENTITY CASCADE`;

    const accountId = await seedAccount(db);
    workspaceId = id('ws');
    await db
      .insert(workspaces)
      .values({ id: workspaceId, accountId, name: 'Ret', slug: `ret-${id('ws')}` });
    const categoryId = id('cat');
    await db.insert(categories).values({ id: categoryId, workspaceId, name: 'C', slug: 'c' });
    streamId = id('stm');
    await db.insert(streams).values({ id: streamId, categoryId, name: 'S', slug: 's' });
    sourceId = id('src');
    await db.insert(sources).values({ id: sourceId, workspaceId, name: 'Agent' });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`TRUNCATE reports, report_metrics RESTART IDENTITY CASCADE`;
  });

  const NOW = new Date('2026-06-20T00:00:00.000Z');
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

  it('RETENTION_DAYS = 0 deletes nothing', async () => {
    await seedReportAt(daysAgo(1000));
    await seedReportAt(daysAgo(1));
    const deleted = await purgeExpiredReports(db, 0, NOW);
    expect(deleted).toBe(0);
    expect(await countReports()).toBe(2);
  });

  it('keys on server created_at: deletes only rows older than the window, returns the count', async () => {
    const old1 = await seedReportAt(daysAgo(40));
    const old2 = await seedReportAt(daysAgo(31));
    const fresh1 = await seedReportAt(daysAgo(29));
    const fresh2 = await seedReportAt(daysAgo(1));

    const deleted = await purgeExpiredReports(db, 30, NOW);
    expect(deleted).toBe(2);

    const remaining = await sql<{ id: string }[]>`SELECT id FROM reports ORDER BY id`;
    const ids = remaining.map((r) => r.id).sort();
    expect(ids).toEqual([fresh1, fresh2].sort());
    expect(ids).not.toContain(old1);
    expect(ids).not.toContain(old2);
  });

  it('cascades report_metrics when an expired report is purged', async () => {
    const old = await seedReportAt(daysAgo(60));
    await db.insert(reportMetrics).values({
      id: id('mtr'),
      reportId: old,
      streamId,
      key: 'k',
      value: 1,
      occurredAt: daysAgo(60),
    });
    const fresh = await seedReportAt(daysAgo(1));
    await db.insert(reportMetrics).values({
      id: id('mtr'),
      reportId: fresh,
      streamId,
      key: 'k',
      value: 2,
      occurredAt: daysAgo(1),
    });

    const deleted = await purgeExpiredReports(db, 30, NOW);
    expect(deleted).toBe(1);

    const metrics = await db.select().from(reportMetrics);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].reportId).toBe(fresh);
  });

  it('runner.runOnce purges and records status when retention is enabled', async () => {
    await seedReportAt(daysAgo(100));
    await seedReportAt(daysAgo(2));
    const runner = createRetentionRunner({
      db,
      sql,
      retentionDays: 30,
      sweepIntervalMs: 60_000,
      now: () => NOW,
    });

    const outcome = await runner.runOnce();
    expect(outcome).toBe('success');
    expect(await countReports()).toBe(1);

    const status = runner.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.lastOutcome).toBe('success');
    expect(status.lastDeletedCount).toBe(1);
    expect(status.runs).toBe(1);
    expect(status.lastRunAt).not.toBeNull();
  });

  it('advisory lock makes the purge single-run: a replica that loses the lock skips (no delete)', async () => {
    await seedReportAt(daysAgo(100));
    await seedReportAt(daysAgo(100));

    // Simulate another replica holding the retention lock on its own session.
    const holder = await sql.reserve();
    await holder`SELECT pg_advisory_lock(${RETENTION_PURGE_LOCK})`;
    try {
      const runner = createRetentionRunner({
        db,
        sql,
        retentionDays: 30,
        sweepIntervalMs: 60_000,
        now: () => NOW,
      });
      const outcome = await runner.runOnce();
      expect(outcome).toBe('skipped'); // lost the lock
      expect(await countReports()).toBe(2); // nothing deleted
      expect(runner.getStatus().runs).toBe(0);
    } finally {
      await holder`SELECT pg_advisory_unlock(${RETENTION_PURGE_LOCK})`;
      holder.release();
    }
  });
});
