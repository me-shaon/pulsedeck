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
      'billing_accounts',
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

  it('keeps the billing table (billing_accounts) distinct from better-auth account', async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('billing_accounts', 'accounts', 'account')
    `;
    const tables = new Set(rows.map((r) => r.table_name));
    // Billing/tenancy table is the renamed one.
    expect(tables.has('billing_accounts')).toBe(true);
    // The old, ambiguous name must be gone (renamed, not duplicated).
    expect(tables.has('accounts')).toBe(false);
    // better-auth's credential table is untouched and still present.
    expect(tables.has('account')).toBe(true);
  });

  it('points the workspaces FK at billing_accounts', async () => {
    const rows = await sql<{ foreign_table_name: string }[]>`
      select ccu.table_name as foreign_table_name
      from information_schema.table_constraints tc
      join information_schema.constraint_column_usage ccu
        on tc.constraint_name = ccu.constraint_name
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_name = 'workspaces'
        and tc.constraint_name = 'workspaces_account_id_billing_accounts_id_fk'
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.foreign_table_name).toBe('billing_accounts');
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
