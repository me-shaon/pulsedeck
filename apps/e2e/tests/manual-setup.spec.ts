import { test, expect, type Page } from '@playwright/test';
import { resetToZeroUsers } from './helpers/db';

/**
 * Manual setup of categories & streams from the sidebar, plus the
 * "Copy agent instructions" affordance. Proves an operator can build structure
 * by hand (not only via agent autocreate) and reach the destination-scoped
 * instruction flow.
 *
 * WARNING: like the other E2E specs this TRUNCATEs the target database (default
 * the dev DB on :5544). Run against a disposable database / in CI — never a DB
 * whose data you care about.
 *
 * Serial: the first test provisions the admin the later steps rely on.
 */
const admin = {
  name: 'E2E Setup Admin',
  email: 'e2e-setup@test.com',
  password: 'supersecret1',
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetToZeroUsers();
});

async function setupAndEnter(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await page.fill('input[autocomplete="name"]', admin.name);
  await page.fill('input[type="email"]', admin.email);
  await page.fill('input[type="password"]', admin.password);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page).toHaveURL(/\/w\//, { timeout: 15_000 });
}

test('operator creates a category and a stream from the sidebar', async ({ page }) => {
  await setupAndEnter(page);

  // Create a category.
  await page.getByRole('button', { name: 'New category' }).click();
  await page.getByLabel('category name').fill('Infrastructure');
  await page.getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByText('Infrastructure')).toBeVisible();

  // Add a stream under it.
  await page.getByRole('button', { name: 'Add stream to Infrastructure' }).click();
  await page.getByLabel('stream name').fill('System Health');
  await page.getByRole('button', { name: 'Create stream' }).click();
  await expect(page.getByRole('link', { name: /System Health/ })).toBeVisible();
});

test('operator renames the stream and the label persists', async ({ page }) => {
  await setupAndEnter(page);

  // Open the stream's row menu → Rename.
  await page.getByRole('button', { name: 'System Health options' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const input = page.getByLabel('stream name');
  await input.fill('Prod Health');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('link', { name: /Prod Health/ })).toBeVisible();
  // Survives a reload (persisted server-side, slug unchanged).
  await page.reload();
  await expect(page.getByRole('link', { name: /Prod Health/ })).toBeVisible();
});

test('the copy-agent-instructions dialog opens for a stream', async ({ page }) => {
  await setupAndEnter(page);

  await page.getByRole('button', { name: 'Prod Health options' }).click();
  await page.getByRole('menuitem', { name: 'Copy agent instructions' }).click();

  // The dialog appears. With no source yet, it points the operator at Sources.
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/Agent instructions/)).toBeVisible();
});
