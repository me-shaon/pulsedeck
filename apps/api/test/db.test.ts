import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { createDrizzle, id, type Db } from '../src/db/index.js';
import { runMigrations } from '../src/migrate.js';
import { workspaces } from '../src/db/schema/index.js';
import type { Sql } from '../src/db.js';
import { seedAccount } from './helpers.js';

/**
 * Integration test for the Drizzle schema + migrations. Gated behind
 * DATABASE_URL: it is skipped entirely when the variable is unset, so the
 * default unit-test run needs no Postgres. CI / the controller runs it against
 * a real Postgres after `db:generate` has produced the migration SQL.
 *
 *   DATABASE_URL=postgres://... pnpm --filter @pulsedeck/api test
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('database schema (integration)', () => {
  let sql: Sql;
  let db: Db;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
    db = createDrizzle(sql);
    // Apply the generated migrations to whatever DB DATABASE_URL points at.
    await runMigrations(sql);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('creates the core tables', async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
    `;
    const tables = new Set(rows.map((r) => r.table_name));
    for (const expected of [
      'workspaces',
      'workspace_members',
      'users',
      'sources',
      'source_categories',
      'source_streams',
      'categories',
      'streams',
      'reports',
      'report_metrics',
      'dashboards',
    ]) {
      expect(tables.has(expected)).toBe(true);
    }
  });

  it('enforces the (source_id, idempotency_key) unique index on reports', async () => {
    const idx = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes
      where tablename = 'reports' and indexname = 'reports_source_idempotency_uq'
    `;
    expect(idx.length).toBe(1);
  });

  it('has a GIN index backing report full-text search', async () => {
    const idx = await sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes
      where tablename = 'reports' and indexname = 'reports_search_vector_idx'
    `;
    expect(idx.length).toBe(1);
    expect(idx[0]!.indexdef.toLowerCase()).toContain('gin');
  });

  it('rejects a duplicate workspace slug', async () => {
    const slug = `it-${id('ws')}`;
    const accountId = await seedAccount(db);

    await db.insert(workspaces).values({ id: id('ws'), accountId, name: 'First', slug });

    await expect(
      db.insert(workspaces).values({ id: id('ws'), accountId, name: 'Second', slug }),
    ).rejects.toThrow();

    // Cleanup so repeated local runs stay green.
    await sql`delete from workspaces where slug = ${slug}`;
  });
});
