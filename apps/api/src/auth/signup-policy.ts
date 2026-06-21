import type { SignupMode } from '../config/runtime.js';

/**
 * Signup policy — decides whether a new account/user may be created, driven by
 * the deployment's `signup_mode`. Pure so it's trivially unit-testable and the
 * cloud package can call it from its self-serve signup handler without forking.
 *
 *   setup  — only the first-run admin (OSS default). No self-serve signup.
 *   open   — anyone may self-serve sign up (cloud).
 *   invite — no self-serve signup; users join only via an invite token.
 */

export type SignupContext = {
  /** True when there are zero users yet (the first-run admin case). */
  isFirstRun: boolean;
};

/** Whether a (non-invite) signup attempt is permitted under the current mode. */
export function isSignupAllowed(mode: SignupMode, ctx: SignupContext): boolean {
  switch (mode) {
    case 'open':
      return true;
    case 'setup':
      return ctx.isFirstRun;
    case 'invite':
      // Invite acceptance is a separate path; direct signup is never allowed.
      return false;
  }
}

/** Thrown when a signup is rejected by policy. Carries 403 for the error handler. */
export class SignupNotAllowedError extends Error {
  readonly statusCode = 403;
  constructor(mode: SignupMode) {
    super(`Self-serve signup is disabled (signup mode: ${mode})`);
    this.name = 'SignupNotAllowedError';
  }
}
