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
}

/**
 * Inputs the runtime config derives from — the subset of env it reads. All
 * optional so a bare `buildRuntimeConfig({})` yields the self-host defaults.
 */
export type RuntimeConfigEnv = Partial<
  Pick<Env, 'DEPLOYMENT_MODE' | 'SIGNUP_MODE' | 'BILLING_ENABLED'>
>;

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
  };
}
