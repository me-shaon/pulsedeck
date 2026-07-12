import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { billingAccounts, createDrizzle, id, users, workspaces, type Db } from '../src/db/index.js';
import { countWebhooks, countWorkspaces, LimitExceededError } from '../src/services/limits.js';
import { createWorkspaceWithOwnerWithinLimit } from '../src/services/workspaces.js';
import { createWebhookWithinLimit } from '../src/services/webhooks.js';

/**
 * Concurrency regression for account quota enforcement. The vulnerable version
 * read the count and inserted in two unlocked round-trips, so N simultaneous
 * creates could each observe `count = limit-1` and all insert, overshooting the
 * quota. The fix serializes count+insert under a per-account advisory lock, so
 * under contention exactly `limit` creates win and the rest get 402.
 *
 * Gated on DATABASE_URL (skipped otherwise) — it needs a real Postgres to
 * exercise the advisory lock and MVCC.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** Fan out `n` create attempts at once; return how many won vs hit the limit. */
async function race<T>(
  attempts: Array<() => Promise<T>>,
): Promise<{ ok: number; limited: number; other: unknown[] }> {
  const settled = await Promise.allSettled(attempts.map((fn) => fn()));
  let ok = 0;
  let limited = 0;
  const other: unknown[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') ok++;
    else if (r.reason instanceof LimitExceededError) limited++;
    else other.push(r.reason);
  }
  return { ok, limited, other };
}

describeIfDb('account quota under concurrency (integration)', () => {
  let sql: postgres.Sql;
  let db: Db;

  const CONCURRENCY = 12;
  const LIMIT = 3;

  async function seedUser(): Promise<string> {
    const userId = id('usr');
    await db.insert(users).values({ id: userId, email: `${userId}@example.com`, name: 'Owner' });
    return userId;
  }

  async function seedAccount(
    limits: Partial<typeof billingAccounts.$inferInsert>,
  ): Promise<string> {
    const accountId = id('acc');
    await db.insert(billingAccounts).values({ id: accountId, name: 'Capped Account', ...limits });
    return accountId;
  }

  beforeEach(async () => {
    sql = postgres(DATABASE_URL!, { max: CONCURRENCY + 2, onnotice: () => {} });
    db = createDrizzle(sql);
    await sql`TRUNCATE users, billing_accounts, workspaces, workspace_members, webhooks RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('never exceeds maxWorkspaces when creates race', async () => {
    const ownerId = await seedUser();
    const accountId = await seedAccount({ maxWorkspaces: LIMIT });

    const { ok, limited, other } = await race(
      Array.from(
        { length: CONCURRENCY },
        (_, i) => () => createWorkspaceWithOwnerWithinLimit(db, ownerId, `ws-${i}`, accountId),
      ),
    );

    expect(other).toEqual([]);
    expect(ok).toBe(LIMIT);
    expect(limited).toBe(CONCURRENCY - LIMIT);
    expect(await countWorkspaces(db, accountId)).toBe(LIMIT);
  });

  it('never exceeds maxWebhooks when creates race', async () => {
    const accountId = await seedAccount({ maxWebhooks: LIMIT });
    const workspaceId = id('ws');
    await db
      .insert(workspaces)
      .values({ id: workspaceId, accountId, name: 'WS', slug: `ws-${workspaceId}` });

    const input = {
      name: 'hook',
      url: 'https://example.com/hook',
      format: 'generic' as const,
      severities: [] as [],
      categoryIds: [] as string[],
      enabled: true,
    };

    const { ok, limited, other } = await race(
      Array.from(
        { length: CONCURRENCY },
        (_, i) => () => createWebhookWithinLimit(db, workspaceId, { ...input, name: `hook-${i}` }),
      ),
    );

    expect(other).toEqual([]);
    expect(ok).toBe(LIMIT);
    expect(limited).toBe(CONCURRENCY - LIMIT);
    expect(await countWebhooks(db, accountId)).toBe(LIMIT);
  });
});
