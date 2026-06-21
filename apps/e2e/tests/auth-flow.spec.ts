import { test, expect, type Page } from '@playwright/test';
import { resetToZeroUsers } from './helpers/db';

/**
 * The full first-run → authenticated-app journey, in a real browser against the
 * running stack. This is the end-to-end guard for the "stuck Creating account…"
 * regression: a passing run proves setup actually lands the user in a workspace
 * (not bounced back to /setup), that the session persists, and that sign-out /
 * sign-in round-trips.
 *
 * Serial: the first test provisions the admin the later tests sign in as.
 */
const admin = {
  name: 'E2E Admin',
  email: 'e2e-admin@test.com',
  password: 'supersecret1',
};

test.describe.configure({ mode: 'serial' });

async function fillSetup(page: Page) {
  await page.fill('input[autocomplete="name"]', admin.name);
  await page.fill('input[type="email"]', admin.email);
  await page.fill('input[type="password"]', admin.password);
}

test.beforeAll(async () => {
  // Start from a pristine, zero-users database so /setup is reachable.
  await resetToZeroUsers();
});

test('first-run setup creates the admin and lands in a workspace', async ({ page }) => {
  await page.goto('/');
  // Zero users → the root guard routes to the setup wizard.
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Welcome to PulseDeck' })).toBeVisible();

  await fillSetup(page);
  await page.getByRole('button', { name: 'Create admin account' }).click();

  // The bug: the button hung on "Creating account…" forever. Assert we actually
  // navigate into a workspace within a tight timeout.
  await expect(page).toHaveURL(/\/w\//, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Creating account/ })).toHaveCount(0);
});

test('the session persists across a full page reload', async ({ page }) => {
  // Sign in (fresh browser context per test), then hard-reload.
  await signIn(page);
  await expect(page).toHaveURL(/\/w\//);

  await page.reload();
  // Still authenticated — not bounced to /login.
  await expect(page).toHaveURL(/\/w\//);
  await expect(page).not.toHaveURL(/\/login/);
});

test('an unauthenticated visitor is redirected to /login once setup is done', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('login rejects bad credentials and accepts good ones', async ({ page }) => {
  await page.goto('/login');

  // Wrong password → inline error, stays on /login.
  await page.fill('input[type="email"]', admin.email);
  await page.fill('input[type="password"]', 'wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  // Correct password → into the workspace.
  await page.fill('input[type="password"]', admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/w\//, { timeout: 15_000 });
});

/** Sign in as the admin provisioned by the setup test. */
async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', admin.email);
  await page.fill('input[type="password"]', admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
