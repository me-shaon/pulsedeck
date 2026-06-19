import { config } from 'dotenv';
import { z } from 'zod';

// Load a local .env if present; real env always wins.
config();

const EnvSchema = z.object({
  // Required — the API refuses to boot without these.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required'),

  // Optional — sensible defaults.
  PORT: z.coerce.number().int().positive().default(3001),
  RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
  REDIS_URL: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  BOOTSTRAP_EMAIL: z.string().optional(),
  BOOTSTRAP_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Parse and validate process environment. Throws an Error with a readable,
 * multi-line message listing every offending variable so startup fails fast.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
