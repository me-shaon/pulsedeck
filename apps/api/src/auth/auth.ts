import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Db } from '../db/index.js';
import { accounts, sessions, users, verifications } from '../db/schema/index.js';

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
export function createAuth(db: Db, env: AuthEnv = {}) {
  const github = isGithubEnabled(env)
    ? {
        github: {
          clientId: env.GITHUB_CLIENT_ID as string,
          clientSecret: env.GITHUB_CLIENT_SECRET as string,
        },
      }
    : undefined;

  return betterAuth({
    // `AUTH_SECRET` is required by `env.ts` for real boots; the placeholder only
    // applies when `createAuth` is built with no env (e.g. the DB-less health
    // unit test) so construction never throws on a missing secret.
    secret: env.AUTH_SECRET ?? 'pulsedeck-dev-insecure-secret-placeholder-0001',
    baseURL: env.BETTER_AUTH_URL,
    // Conventional better-auth mount path; the Fastify handler is registered at
    // `/api/auth/*` to match (see `src/auth/fastify.ts`).
    basePath: '/api/auth',
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    ...(github ? { socialProviders: github } : {}),
  });
}

/** The configured better-auth instance type. */
export type Auth = ReturnType<typeof createAuth>;

/** The authenticated user shape better-auth resolves from a session. */
type SessionResult = Awaited<ReturnType<Auth['api']['getSession']>>;
export type AuthUser = NonNullable<SessionResult>['user'];
