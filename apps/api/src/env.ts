import { config } from 'dotenv';
import { z } from 'zod';

// Load a local .env if present; real env always wins.
config();

/**
 * Substrings that mark an AUTH_SECRET as a non-secret placeholder / dev value.
 * A copied `.env.example`, the compose fallback, or the local dev dummy all match
 * one of these. Rejected at boot when `NODE_ENV=production` (see superRefine
 * below) so a known value can never reach a real deployment, while local dev
 * (NODE_ENV=development) keeps booting on the dummy for a smooth setup.
 */
const PLACEHOLDER_SECRET_RE = /change-?me|insecure|dev-only|placeholder|secret-string|example/i;

/**
 * Database passwords that are defaults/dev values and must never reach a
 * production DATABASE_URL. The compose dev default is `pulsedeck`; the rest are
 * the usual Postgres/example defaults. Checked at boot when NODE_ENV=production.
 */
const WEAK_DB_PASSWORDS = new Set([
  'pulsedeck',
  'postgres',
  'password',
  'root',
  'admin',
  'changeme',
]);

const EnvSchema = z
  .object({
    // Runtime mode. `production` hardens checks (e.g. rejects placeholder
    // secrets, see superRefine). Unset is treated as development. The production
    // compose sets this to `production`; the dev overlay sets `development`.
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // Required — the API refuses to boot without these.
    DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection URL'),
    // Signing secret. Length is enforced for all modes; production additionally
    // rejects known placeholder/dev values (superRefine below).
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
    // Coerce empty string → undefined: the compose stack passes `REDIS_URL=""`
    // when unset, which must mean "no Redis", not an invalid URL that fails boot.
    REDIS_URL: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().url('REDIS_URL must be a valid connection URL').optional(),
    ),
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

    // Per-source ingestion rate limit (PRD "per-source rate limits"). Read here so
    // no route reaches into process.env directly.
    //   INGEST_RATE_LIMIT  — max requests per window (default 120).
    //   INGEST_RATE_WINDOW — window as ms (number) or an `ms`-style string like
    //                        "1 minute" (default 60000 ms).
    INGEST_RATE_LIMIT: z.coerce.number().int().positive().default(120),
    INGEST_RATE_WINDOW: z.string().optional(),

    // Brute-force throttle for the sensitive auth endpoints (sign-in/up, password
    // reset). Keyed per client IP (so set TRUST_PROXY behind a reverse proxy).
    //   AUTH_RATE_LIMIT  — max attempts per window (default 20).
    //   AUTH_RATE_WINDOW — window as ms or an `ms`-style string (default 60000 ms).
    AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),
    AUTH_RATE_WINDOW: z.string().optional(),

    // Reverse-proxy trust (Fastify `trustProxy`). Behind the bundled nginx set
    // this to the number of proxy hops (`1`) so `request.ip` / X-Forwarded-* are
    // the real client, not the proxy — required for IP-keyed rate limits to work.
    // Accepts `true`/`false`, a hop count (`1`), or an IP/CIDR. Default off (safe:
    // don't trust forwarded headers unless a proxy is actually in front).
    TRUST_PROXY: z.string().optional(),

    // Transactional email seam (invites now; trial reminders/receipts later in
    // cloud). OSS leaves EMAIL_PROVIDER unset → the console no-op port: nothing is
    // sent, no provider is required, invites still surface their URL in the API
    // response. The cloud package binds a real provider keyed off these.
    EMAIL_PROVIDER: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    // SMTP transport (OSS self-host email). Active only when EMAIL_PROVIDER=smtp
    // AND SMTP_HOST is set (see config/runtime `isEmailConfigured`); enables
    // password-reset + workspace-invite delivery. Unset → console no-op default.
    //   SMTP_PORT   — default 587 (STARTTLS); use 465 with SMTP_SECURE=true.
    //   SMTP_SECURE — true for implicit TLS (port 465); false/unset → STARTTLS.
    SMTP_HOST: z.string().optional(),
    // Coerce empty string → undefined first: the compose passthrough sends
    // `SMTP_PORT=""` when unset, which `z.coerce.number()` would turn into 0 and
    // fail `.positive()`, aborting boot. Empty must mean "use the default".
    SMTP_PORT: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.coerce.number().int().positive().optional(),
    ),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_SECURE: z
      .string()
      .optional()
      .transform((v) => (v == null ? undefined : /^(true|1|yes|on)$/i.test(v.trim()))),

    // Outbound webhook delivery (PRD "Webhooks"). The runner polls the durable
    // `webhook_deliveries` queue and POSTs matching reports to external URLs.
    //   WEBHOOK_POLL_INTERVAL_MS   — how often the runner claims due rows (default 2s).
    //   WEBHOOK_MAX_ATTEMPTS       — per-delivery retry ceiling (default 5).
    //   WEBHOOK_DELIVERY_TIMEOUT_MS— outbound POST timeout (default 10s).
    //   WEBHOOK_BATCH_SIZE         — rows claimed per poll (default 20).
    WEBHOOK_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
    WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    WEBHOOK_DELIVERY_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),
    WEBHOOK_BATCH_SIZE: z.coerce.number().int().min(1).default(20),
    // SSRF policy. Default derived from DEPLOYMENT_MODE (allowed self-host so a
    // deploy can hit internal Slack/services; blocked on cloud where URLs are
    // untrusted multi-tenant input). Accepts false/0/no/off (falsy) or truthy.
    WEBHOOK_ALLOW_PRIVATE_IPS: z
      .string()
      .optional()
      .transform((v) => (v == null ? undefined : !/^(false|0|no|off)$/i.test(v.trim()))),
  })
  .superRefine((env, ctx) => {
    // Fail closed in production on a known placeholder/dev secret. This is the
    // app-layer backstop to the compose `${AUTH_SECRET:?…}` fail-fast: even if a
    // dev `.env` (or a copied `.env.example`) carries the dummy, a production
    // boot aborts here rather than running on a guessable signing key.
    if (env.NODE_ENV === 'production' && PLACEHOLDER_SECRET_RE.test(env.AUTH_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_SECRET'],
        message:
          'AUTH_SECRET is a known placeholder/dev value and must not be used in production. ' +
          'Generate a unique secret: `make setup` (writes .env) or `openssl rand -base64 48`.',
      });
    }

    // Reject the default/dev database password in production (security finding
    // C2). Backstop to the compose `${POSTGRES_PASSWORD:?…}` fail-fast: even a
    // hand-set DATABASE_URL carrying `pulsedeck`/`postgres`/empty aborts the boot.
    if (env.NODE_ENV === 'production') {
      let dbPassword: string | null = null;
      try {
        dbPassword = decodeURIComponent(new URL(env.DATABASE_URL).password);
      } catch {
        // Malformed URL is already reported by the `.url()` check above.
      }
      if (
        dbPassword !== null &&
        (dbPassword === '' ||
          WEAK_DB_PASSWORDS.has(dbPassword.toLowerCase()) ||
          PLACEHOLDER_SECRET_RE.test(dbPassword))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message:
            'DATABASE_URL uses an empty or known default/dev database password and must not be ' +
            'used in production. Generate a strong one: `make setup` (writes .env).',
        });
      }
    }
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
