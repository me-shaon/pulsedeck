import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Db } from '../db/index.js';
import { authAccounts, sessions, users, verifications } from '../db/schema/index.js';
import { createConsoleEmailPort, type EmailPort } from '../services/email.js';

/** Reset-password token lifetime (seconds). Short by design — see the spec. */
const RESET_TOKEN_TTL_SECONDS = 3600;

/** Optional dependencies for `createAuth` (injected at composition time). */
export interface AuthDeps {
  /**
   * Transactional email port used to deliver password-reset links. Defaults to
   * the console no-op so DB-less construction and OSS-without-mail still work;
   * the resolved SMTP/cloud port is passed in from `index.ts`/`server.ts`.
   */
  email?: EmailPort;
}

/**
 * Auth-relevant slice of the validated environment. Kept as an interface (not
 * the full `Env`) so `createAuth` can be exercised in isolation and so the
 * GitHub opt-in branch is trivially testable.
 */
export interface AuthEnv {
  AUTH_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  BETTER_AUTH_URL?: string;
}

/**
 * GitHub OAuth is opt-in: it is configured ONLY when both the client id and
 * secret are present. When either is missing the social provider is omitted
 * entirely, so the login screen can hide the GitHub button by reading
 * `/api/v1/auth/config`.
 */
export function isGithubEnabled(env: AuthEnv): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

/**
 * Build the better-auth instance bound to our Drizzle `Db`.
 *
 * The Drizzle adapter maps better-auth's models onto our existing tables:
 *   - `user`         → Phase 2 `users` (unchanged)
 *   - `session`/`account`/`verification` → Phase 3 tables in `schema/auth.ts`
 *
 * Email/password is enabled (with auto sign-in so `/setup` and bootstrap yield
 * a usable session). GitHub is added only when enabled (see `isGithubEnabled`).
 * `secret` comes from `AUTH_SECRET`; `baseURL` from `BETTER_AUTH_URL` when set.
 */
export function createAuth(db: Db, env: AuthEnv = {}, deps: AuthDeps = {}) {
  const email = deps.email ?? createConsoleEmailPort();
  const github = isGithubEnabled(env)
    ? {
        github: {
          clientId: env.GITHUB_CLIENT_ID as string,
          clientSecret: env.GITHUB_CLIENT_SECRET as string,
        },
      }
    : undefined;

  // Behind nginx the browser's Origin is the public web origin, which equals
  // `BETTER_AUTH_URL`. better-auth already trusts `baseURL` by default, but we
  // set `trustedOrigins` explicitly so the origin/CSRF check is unambiguous (and
  // unit-testable) when the app is fronted by a reverse proxy.
  const trustedOrigins = env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : undefined;

  return betterAuth({
    // `AUTH_SECRET` is required by `env.ts` for real boots; the placeholder only
    // applies when `createAuth` is built with no env (e.g. the DB-less health
    // unit test) so construction never throws on a missing secret.
    secret: env.AUTH_SECRET ?? 'pulsedeck-dev-insecure-secret-placeholder-0001',
    baseURL: env.BETTER_AUTH_URL,
    ...(trustedOrigins ? { trustedOrigins } : {}),
    // Conventional better-auth mount path; the Fastify handler is registered at
    // `/api/auth/*` to match (see `src/auth/fastify.ts`).
    basePath: '/api/auth',
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: authAccounts,
        verification: verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      // Reset tokens are short-lived; the link is delivered out-of-band via the
      // email port (SMTP in OSS, console no-op when unconfigured). The web warns
      // when delivery isn't configured (see `/api/v1/auth/config` emailConfigured).
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      async sendResetPassword({ user, url }) {
        await email.send({
          to: user.email,
          template: 'password-reset',
          data: { url, name: user.name },
        });
      },
    },
    ...(github ? { socialProviders: github } : {}),
  });
}

/** The configured better-auth instance type. */
export type Auth = ReturnType<typeof createAuth>;

/** The authenticated user shape better-auth resolves from a session. */
type SessionResult = Awaited<ReturnType<Auth['api']['getSession']>>;
export type AuthUser = NonNullable<SessionResult>['user'];
