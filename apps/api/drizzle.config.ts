import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit config. `db:generate` reads the schema barrel and emits SQL +
 * snapshots into `./drizzle`, which `src/migrate.ts` applies on startup.
 *
 * Column names are declared explicitly (snake_case) in the schema, so no
 * `casing` transform is needed here.
 */
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
