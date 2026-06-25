import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  categories,
  createDrizzle,
  id,
  reports,
  sources,
  streams,
  workspaces,
  type Db,
} from '../src/db/index.js';
import type { Sql } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import {
  archiveReports,
  deleteReports,
  unarchiveReports,
} from '../src/services/reports-mutations.js';
import { seedAccount } from './helpers.js';

/**
 * Phase: archive/delete mutation service against a real Postgres (gated on
 * DATABASE_URL; skipped otherwise). Exercises archive/unarchive/delete directly
 * at the service layer: happy paths, workspace scoping (foreign ids never
 * affected), idempotency, and empty-input short-circuit.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('report mutations service (integration)', () => {
  let sqlClient: Sql;
  let db: Db;

  let ws1: string;
  let ws2: string;
  let streamId: string;
  let sourceId: string;
  let foreignStreamId: string;
  let foreignSourceId: string;

  async function seedReport(opts: {
    streamId: string;
    workspaceId: string;
    sourceId: string;
    archivedAt?: Date | null;
  }): Promise<string> {
    const rid = id('rpt');
    await db.insert(reports).values({
      id: rid,
      streamId: opts.streamId,
      workspaceId: opts.workspaceId,
      sourceId: opts.sourceId,
      idempotencyKey: rid,
      title: 'seed',
      summary: null,
      severity: null,
      occurredAt: new Date('2026-01-01T00:00:00Z'),
      receivedAt: new Date('2026-01-01T00:00:00Z'),
      archivedAt: opts.archivedAt ?? null,
      tags: [],
      blocks: [],
      searchVector: sql`to_tsvector('english', 'seed')`,
    });
    return rid;
  }

  async function archivedAtOf(rid: string): Promise<Date | null | undefined> {
    const [row] = await db
      .select({ archivedAt: reports.archivedAt })
      .from(reports)
      .where(sql`${reports.id} = ${rid}`);
    return row?.archivedAt;
  }

  beforeAll(async () => {
    sqlClient = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sqlClient);
    await runMigrations(sqlClient);
    await sqlClient`TRUNCATE users, billing_accounts, workspaces, workspace_members, invites, sources,
      source_registration_tokens, source_categories, source_streams, categories,
      streams, reports, report_metrics, account, session, verification
      RESTART IDENTITY CASCADE`;

    const acc1 = await seedAccount(db, 'Acct 1');
    const acc2 = await seedAccount(db, 'Acct 2');
    ws1 = id('ws');
    ws2 = id('ws');
    await db.insert(workspaces).values([
      { id: ws1, accountId: acc1, name: 'W1', slug: `w1-${id('ws')}` },
      { id: ws2, accountId: acc2, name: 'W2', slug: `w2-${id('ws')}` },
    ]);
    const cat1 = id('cat');
    const cat2 = id('cat');
    await db.insert(categories).values([
      { id: cat1, workspaceId: ws1, name: 'C1', slug: 'c1' },
      { id: cat2, workspaceId: ws2, name: 'C2', slug: 'c2' },
    ]);
    streamId = id('stm');
    foreignStreamId = id('stm');
    await db.insert(streams).values([
      { id: streamId, categoryId: cat1, name: 'S1', slug: 's1' },
      { id: foreignStreamId, categoryId: cat2, name: 'S2', slug: 's2' },
    ]);
    sourceId = id('src');
    foreignSourceId = id('src');
    await db.insert(sources).values([
      { id: sourceId, workspaceId: ws1, name: 'Src1' },
      { id: foreignSourceId, workspaceId: ws2, name: 'Src2' },
    ]);
  });

  beforeEach(async () => {
    await sqlClient`DELETE FROM reports`;
  });

  afterAll(async () => {
    await sqlClient?.end({ timeout: 5 });
  });

  it('archive sets archivedAt and returns count + streamIds', async () => {
    const a = await seedReport({ streamId, workspaceId: ws1, sourceId });
    const b = await seedReport({ streamId, workspaceId: ws1, sourceId });
    const res = await archiveReports(db, ws1, [a, b]);
    expect(res.affected).toBe(2);
    expect(res.streamIds).toEqual([streamId]);
    expect(await archivedAtOf(a)).toBeInstanceOf(Date);
  });

  it('unarchive clears archivedAt', async () => {
    const a = await seedReport({
      streamId,
      workspaceId: ws1,
      sourceId,
      archivedAt: new Date('2026-02-01T00:00:00Z'),
    });
    const res = await unarchiveReports(db, ws1, [a]);
    expect(res.affected).toBe(1);
    expect(await archivedAtOf(a)).toBeNull();
  });

  it('delete permanently removes the rows', async () => {
    const a = await seedReport({ streamId, workspaceId: ws1, sourceId });
    const res = await deleteReports(db, ws1, [a]);
    expect(res.affected).toBe(1);
    expect(await archivedAtOf(a)).toBeUndefined(); // row gone
  });

  it('foreign-workspace ids are never affected (archive)', async () => {
    const foreign = await seedReport({
      streamId: foreignStreamId,
      workspaceId: ws2,
      sourceId: foreignSourceId,
    });
    const res = await archiveReports(db, ws1, [foreign]);
    expect(res.affected).toBe(0);
    expect(await archivedAtOf(foreign)).toBeNull(); // untouched
  });

  it('foreign-workspace ids are never affected (delete)', async () => {
    const foreign = await seedReport({
      streamId: foreignStreamId,
      workspaceId: ws2,
      sourceId: foreignSourceId,
    });
    const res = await deleteReports(db, ws1, [foreign]);
    expect(res.affected).toBe(0);
    expect(await archivedAtOf(foreign)).toBeNull(); // row still present, not deleted
  });

  it('re-archiving an archived report is a no-op (idempotent)', async () => {
    const a = await seedReport({
      streamId,
      workspaceId: ws1,
      sourceId,
      archivedAt: new Date('2026-02-01T00:00:00Z'),
    });
    const res = await archiveReports(db, ws1, [a]);
    expect(res.affected).toBe(0);
  });

  it('mixed ids: only eligible same-workspace rows change', async () => {
    const active = await seedReport({ streamId, workspaceId: ws1, sourceId });
    const alreadyArchived = await seedReport({
      streamId,
      workspaceId: ws1,
      sourceId,
      archivedAt: new Date('2026-02-01T00:00:00Z'),
    });
    const foreign = await seedReport({
      streamId: foreignStreamId,
      workspaceId: ws2,
      sourceId: foreignSourceId,
    });
    const res = await archiveReports(db, ws1, [active, alreadyArchived, foreign]);
    expect(res.affected).toBe(1); // only the active ws1 report
  });

  it('empty ids short-circuit to zero', async () => {
    expect(await archiveReports(db, ws1, [])).toEqual({
      affected: 0,
      streamIds: [],
      reportIds: [],
    });
    expect(await deleteReports(db, ws1, [])).toEqual({ affected: 0, streamIds: [], reportIds: [] });
  });
});
