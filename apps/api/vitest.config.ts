import { defineConfig } from 'vitest/config';

/**
 * DB-backed integration tests share a single Postgres (via DATABASE_URL) and
 * some truncate auth/workspace tables to assert the zero-users setup flow.
 * Disable cross-file parallelism so those files don't race the schema test.
 * Pure unit files (rbac, health) are unaffected by the small serialization.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
