import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end suite that drives the REAL stack in a browser.
 *
 * It expects the docker-compose stack to be already running (web on
 * `WEB_URL`, Postgres on `DATABASE_URL`):
 *
 *   docker compose up -d --build
 *   pnpm --filter @pulsedeck/e2e test
 *
 * Both endpoints are overridable via env so the same suite runs against a
 * non-default port mapping or a remote environment.
 */
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
