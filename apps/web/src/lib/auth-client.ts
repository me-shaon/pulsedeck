import { createAuthClient } from 'better-auth/react';
import type { SessionUser } from './api-types';

/**
 * better-auth React client. Same-origin: the server mounts auth at
 * `/api/auth` (better-auth's default basePath), so the inferred origin works
 * with our dev proxy and the prod nginx passthrough alike.
 */
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : undefined,
});

export const { useSession, signIn, signOut, signUp, requestPasswordReset, resetPassword } =
  authClient;

/**
 * Imperative session fetch for router `beforeLoad` guards (where hooks can't
 * run). Returns the user or `null`.
 */
export async function fetchSessionUser(): Promise<SessionUser | null> {
  const { data } = await authClient.getSession();
  if (!data?.user) return null;
  const u = data.user;
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    image: u.image ?? null,
  };
}
