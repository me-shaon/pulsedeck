import { config } from 'dotenv';
import { z } from 'zod';

// Load a local .env if present; real env always wins.
config();

const EnvSchema = z.object({
  // Required — the API refuses to boot without these.
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection URL'),
  // Signing secret: reject weak values at boot rather than in production.
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),

  // Optional — sensible defaults.
  PORT: z.coerce.number().int().positive().default(3001),
  RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
  REDIS_URL: z.string().url('REDIS_URL must be a valid connection URL').optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  BOOTSTRAP_EMAIL: z.string().optional(),
  BOOTSTRAP_PASSWORD: z.string().optional(),
  // Public origin better-auth uses to build OAuth callback URLs and validate
  // origins. Optional: only needed for social login / cross-origin clients.
  BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be a valid URL').optional(),
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
