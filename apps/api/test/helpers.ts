import { billingAccounts, id, type Db } from '../src/db/index.js';

/**
 * Seed a bare billing account (limits null = unlimited) and return its id, so
 * integration tests that insert workspaces directly can satisfy the now-required
 * `workspaces.account_id` FK. Tests that go through `/setup` get an account for
 * free via the provisioner and don't need this.
 */
export async function seedAccount(db: Db, name = 'Test Account'): Promise<string> {
  const accountId = id('acc');
  await db.insert(billingAccounts).values({ id: accountId, name });
  return accountId;
}
