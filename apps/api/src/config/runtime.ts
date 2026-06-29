import type { Env } from '../env.js';

/**
 * Runtime (deploy-time) configuration — the single typed source the app reads
 * deploy-level behavior from, so no module reaches into `process.env` directly.
 *
 * One knob (`DEPLOYMENT_MODE`) sets the defaults; each derived flag stays
 * individually overridable via its own env var. This is the seam the cloud
 * package configures purely by setting env — it never edits OSS code:
 *
 *   self-host (default):  signup=setup,  billing off, single implicit account,
 *                         retention = global RETENTION_DAYS only.
 *   cloud:                signup=open,   billing on,  multi-account,
 *                         per-account retention windows enforced.
 */

export type DeploymentMode = 'self-host' | 'cloud';
export type SignupMode = 'setup' | 'open' | 'invite';

export interface RuntimeConfig {
  /** Deployment profile. */
  mode: DeploymentMode;
  /** Convenience: `mode === 'cloud'`. */
  isCloud: boolean;
  /** How new accounts/users may be created. */
  signupMode: SignupMode;
  /** Whether billing UI/routes are active (drives the capabilities surface). */
  billingEnabled: boolean;
  /** Whether one deployment hosts many accounts (cloud) vs one implicit (OSS). */
  multiAccount: boolean;
  /**
   * Whether the retention sweep should honor per-account retention windows even
   * when the global RETENTION_DAYS default is 0. OSS keeps this off (retention
   * is opt-in via RETENTION_DAYS); cloud turns it on so each plan's window
   * applies.
   */
  perAccountRetention: boolean;
  /** Per-source ingestion rate limit (env `INGEST_RATE_*`). */
  ingest: {
    /** Max requests per window. */
    max: number;
    /** Window as ms (number) or an `ms`-style string (e.g. "1 minute"). */
    timeWindow: number | string;
  };
  /** Brute-force throttle for sensitive auth endpoints (env `AUTH_RATE_*`). */
  auth: {
    /** Max attempts per window, per client IP. */
    max: number;
    /** Window as ms (number) or an `ms`-style string (e.g. "1 minute"). */
    timeWindow: number | string;
  };
  /**
   * Fastify `trustProxy` value (env `TRUST_PROXY`). `false` (default) trusts no
   * forwarded headers; a number trusts that many proxy hops; a string is an
   * IP/CIDR. Must be set behind a reverse proxy for IP-keyed limits + real
   * client IPs in logs.
   */
  trustProxy: boolean | number | string;
  /** Transactional email config (env `EMAIL_*`/`SMTP_*`). Provider unset → console no-op. */
  email: {
    /** Logical provider name; unset in OSS (console no-op). `smtp` enables the SMTP port. */
    provider?: string;
    /** From address used by a configured provider. */
    from?: string;
    /**
     * SMTP transport config (env `SMTP_*`). Present only when `SMTP_HOST` is set.
     * Email delivery is active only when `provider === 'smtp'` and this is present
     * (see `isEmailConfigured`); otherwise the console no-op port is used.
     */
    smtp?: {
      host: string;
      port: number;
      user?: string;
      pass?: string;
      secure: boolean;
    };
  };
  /** Outbound webhook delivery config (env `WEBHOOK_*`). */
  webhook: {
    /** How often the delivery runner claims due rows (ms). */
    pollIntervalMs: number;
    /** Per-delivery retry ceiling. */
    maxAttempts: number;
    /** Outbound POST timeout (ms). */
    deliveryTimeoutMs: number;
    /** Rows claimed per poll. */
    batchSize: number;
    /**
     * Whether webhook URLs may resolve to loopback/private/link-local ranges.
     * Mode-derived: allowed self-host (internal Slack/services are a valid
     * target), blocked on cloud (URLs are untrusted multi-tenant input → SSRF
     * defense). Overridable via `WEBHOOK_ALLOW_PRIVATE_IPS`.
     */
    allowPrivateIps: boolean;
  };
}

/**
 * Inputs the runtime config derives from — the subset of env it reads. All
 * optional so a bare `buildRuntimeConfig({})` yields the self-host defaults.
 */
export type RuntimeConfigEnv = Partial<
  Pick<
    Env,
    | 'DEPLOYMENT_MODE'
    | 'SIGNUP_MODE'
    | 'BILLING_ENABLED'
    | 'INGEST_RATE_LIMIT'
    | 'INGEST_RATE_WINDOW'
    | 'AUTH_RATE_LIMIT'
    | 'AUTH_RATE_WINDOW'
    | 'TRUST_PROXY'
    | 'EMAIL_PROVIDER'
    | 'EMAIL_FROM'
    | 'SMTP_HOST'
    | 'SMTP_PORT'
    | 'SMTP_USER'
    | 'SMTP_PASS'
    | 'SMTP_SECURE'
    | 'WEBHOOK_POLL_INTERVAL_MS'
    | 'WEBHOOK_MAX_ATTEMPTS'
    | 'WEBHOOK_DELIVERY_TIMEOUT_MS'
    | 'WEBHOOK_BATCH_SIZE'
    | 'WEBHOOK_ALLOW_PRIVATE_IPS'
  >
>;

/** Default per-source ingestion rate limit when env is unset. */
const DEFAULT_INGEST_MAX = 120;
const DEFAULT_WINDOW_MS = 60_000;
/** Default sensitive-auth attempts per window when env is unset. */
const DEFAULT_AUTH_MAX = 20;

/** Resolve a rate-limit window: a numeric string → ms number, else the raw string. */
function resolveWindow(raw: string | undefined): number | string {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_WINDOW_MS;
  const asNumber = Number(trimmed);
  return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : trimmed;
}

/**
 * Resolve `TRUST_PROXY` to a Fastify `trustProxy` value: `true`/`false`, a hop
 * count, or a literal IP/CIDR string. Unset/empty → `false` (trust nothing).
 */
function resolveTrustProxy(raw: string | undefined): boolean | number | string {
  const trimmed = raw?.trim();
  if (!trimmed) return false;
  if (/^(true|yes|on)$/i.test(trimmed)) return true;
  if (/^(false|no|off)$/i.test(trimmed)) return false;
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  return trimmed; // IP / CIDR list, passed through to proxy-addr
}

/**
 * Derive the typed runtime config from env. Granular flags fall back to
 * mode-appropriate defaults when their own env var is unset.
 */
export function buildRuntimeConfig(env: RuntimeConfigEnv): RuntimeConfig {
  const mode: DeploymentMode = env.DEPLOYMENT_MODE ?? 'self-host';
  const isCloud = mode === 'cloud';
  return {
    mode,
    isCloud,
    signupMode: env.SIGNUP_MODE ?? (isCloud ? 'open' : 'setup'),
    billingEnabled: env.BILLING_ENABLED ?? isCloud,
    multiAccount: isCloud,
    perAccountRetention: isCloud,
    ingest: {
      max: env.INGEST_RATE_LIMIT ?? DEFAULT_INGEST_MAX,
      timeWindow: resolveWindow(env.INGEST_RATE_WINDOW),
    },
    auth: {
      max: env.AUTH_RATE_LIMIT ?? DEFAULT_AUTH_MAX,
      timeWindow: resolveWindow(env.AUTH_RATE_WINDOW),
    },
    trustProxy: resolveTrustProxy(env.TRUST_PROXY),
    email: {
      provider: env.EMAIL_PROVIDER,
      from: env.EMAIL_FROM,
      ...(env.SMTP_HOST
        ? {
            smtp: {
              host: env.SMTP_HOST,
              port: env.SMTP_PORT ?? 587,
              user: env.SMTP_USER,
              pass: env.SMTP_PASS,
              secure: env.SMTP_SECURE ?? false,
            },
          }
        : {}),
    },
    webhook: {
      pollIntervalMs: env.WEBHOOK_POLL_INTERVAL_MS ?? 2000,
      maxAttempts: env.WEBHOOK_MAX_ATTEMPTS ?? 5,
      deliveryTimeoutMs: env.WEBHOOK_DELIVERY_TIMEOUT_MS ?? 10_000,
      batchSize: env.WEBHOOK_BATCH_SIZE ?? 20,
      allowPrivateIps: env.WEBHOOK_ALLOW_PRIVATE_IPS ?? !isCloud,
    },
  };
}

/**
 * Whether transactional email can actually be delivered. True only when the SMTP
 * provider is selected AND its host is configured. Drives the capabilities
 * surface (`/api/v1/auth/config` → `emailConfigured`) so the web can warn on the
 * forgot-password page and show the admin "email not configured" banner. Features
 * that need real delivery (password reset, workspace-invite emails) are inert
 * until this is true.
 */
export function isEmailConfigured(config: RuntimeConfig): boolean {
  return config.email.provider === 'smtp' && Boolean(config.email.smtp?.host);
}
