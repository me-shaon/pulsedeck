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

  // Deployment profile. `self-host` (default) runs the OSS substrate with
  // permissive defaults: first-run setup wizard, no billing, one implicit
  // account, unlimited everything. `cloud` flips the defaults for the granular
  // flags below (public signup, billing on, multi-account, per-account
  // retention). Each granular flag stays individually overridable.
  DEPLOYMENT_MODE: z.enum(['self-host', 'cloud']).default('self-host'),
  // How new accounts/users may be created. Default derived from DEPLOYMENT_MODE
  // in runtime config: `setup` for self-host (first-run wizard only), `open` for
  // cloud (public self-serve signup). `invite` allows only invited joins.
  SIGNUP_MODE: z.enum(['setup', 'open', 'invite']).optional(),
  // Whether billing UI/routes are active. Default derived from DEPLOYMENT_MODE
  // (off self-host, on cloud). Accepts false/0/no/off (falsy) or any truthy string.
  BILLING_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v == null ? undefined : !/^(false|0|no|off)$/i.test(v.trim()))),

  RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
  // How often the in-process retention sweep runs (ms). Only meaningful when
  // RETENTION_DAYS > 0. Default 1h. Min 1s so a misconfig can't busy-loop.
  RETENTION_SWEEP_INTERVAL_MS: z.coerce.number().int().min(1000).default(3_600_000),
  REDIS_URL: z.string().url('REDIS_URL must be a valid connection URL').optional(),
  // Realtime SSE master switch (PRD §7 "SSE on/off"). Default ON: the endpoint is
  // available and clients live-update. Set to a falsy value (false/0/no/off) to
  // force the Polling tier — the SSE endpoint then 503s and clients refetch on an
  // interval instead. Redis (REDIS_URL) is an orthogonal concern: it only fans
  // SSE out across replicas and is never required for SSE itself.
  SSE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v == null || !/^(false|0|no|off)$/i.test(v.trim())),
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
