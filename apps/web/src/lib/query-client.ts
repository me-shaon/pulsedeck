import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/**
 * Global session-expiry handler: if any query fails with 401 (the session cookie
 * expired while a view was mounted — the router guards only catch this at
 * navigation time), bounce to /login preserving the current location. A hard
 * redirect also clears in-memory cache. Suppressed on the auth pages themselves
 * to avoid a loop.
 */
const queryCache = new QueryCache({
  onError: (error) => {
    if (error instanceof ApiError && error.status === 401) {
      const path = window.location.pathname;
      if (!path.startsWith('/login') && !path.startsWith('/setup')) {
        const dest = encodeURIComponent(path + window.location.search);
        window.location.assign(`/login?redirect=${dest}`);
      }
    }
  },
});

/**
 * Freshness without realtime: TanStack Query refetches on an interval and on
 * window focus. When SSE lands (Phase 10), the live hook can call
 * `queryClient.invalidateQueries` / `setQueryData` on push and these intervals
 * become a fallback. See `hooks/use-live-updates.ts` for the seam.
 */
export const POLL_INTERVAL_MS = 30_000;

export const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Don't hammer auth/permission failures; they won't fix themselves.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});

/** Stable query-key factory so invalidation stays consistent across the app. */
export const queryKeys = {
  authConfig: ['auth-config'] as const,
  session: ['session'] as const,
  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspace', id] as const,
  tree: (wsId: string) => ['tree', wsId] as const,
  members: (wsId: string) => ['members', wsId] as const,
  invites: (wsId: string) => ['invites', wsId] as const,
  sources: (wsId: string) => ['sources', wsId] as const,
  report: (wsId: string, reportId: string) => ['report', wsId, reportId] as const,
  reports: (wsId: string, scope: unknown) => ['reports', wsId, scope] as const,
};
