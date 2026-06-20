import type { QueryClient } from '@tanstack/react-query';
import { getAuthConfig, getWorkspace, listDashboards, listWorkspaces } from './api';
import { fetchSessionUser } from './auth-client';
import { queryKeys } from './query-client';
import type {
  AuthConfig,
  DashboardListResult,
  SessionUser,
  Workspace,
  WorkspaceListItem,
} from './api-types';

/**
 * Router `beforeLoad` data helpers. They read through TanStack Query so the
 * same values are warm when the matching component mounts. Auth-sensitive keys
 * (`session`) are invalidated explicitly after sign-in/out/setup.
 */

export function ensureAuthConfig(qc: QueryClient): Promise<AuthConfig> {
  return qc.ensureQueryData({
    queryKey: queryKeys.authConfig,
    queryFn: ({ signal }) => getAuthConfig(signal),
    staleTime: 60_000,
  });
}

export function ensureSession(qc: QueryClient): Promise<SessionUser | null> {
  return qc.ensureQueryData({
    queryKey: queryKeys.session,
    queryFn: () => fetchSessionUser(),
    staleTime: 30_000,
  });
}

export function ensureWorkspaces(qc: QueryClient): Promise<WorkspaceListItem[]> {
  return qc
    .ensureQueryData({
      queryKey: queryKeys.workspaces,
      queryFn: ({ signal }) => listWorkspaces(signal),
      staleTime: 30_000,
    })
    .then((res) => res.workspaces);
}

export function ensureWorkspace(
  qc: QueryClient,
  id: string,
): Promise<{ workspace: Workspace; role: Workspace['role'] }> {
  return qc.ensureQueryData({
    queryKey: queryKeys.workspace(id),
    queryFn: ({ signal }) => getWorkspace(id, signal),
    staleTime: 30_000,
  });
}

/**
 * The workspace's dashboards, warm for the landing resolution: `/w/$ws` resolves
 * to the default dashboard when one exists, else falls back to the Overview.
 */
export function ensureDashboards(qc: QueryClient, wsId: string): Promise<DashboardListResult> {
  return qc.ensureQueryData({
    queryKey: queryKeys.dashboards(wsId),
    queryFn: ({ signal }) => listDashboards(wsId, signal),
    staleTime: 15_000,
  });
}

/** Invalidate everything that depends on who is signed in. */
export async function invalidateAuth(qc: QueryClient): Promise<void> {
  // `refetchType: 'all'` is required, not cosmetic: these queries have no active
  // observers on the /setup and /login pages, so a plain invalidate would only
  // mark them stale without refetching. The very next thing the caller does is
  // `navigate('/')`, whose route guards read auth state via `ensureQueryData`,
  // which serves stale-cached data without revalidating — so a setup/sign-in
  // would read the OLD `setupRequired: true` / `session: null` and bounce right
  // back. Forcing the refetch here makes the cache truthful before navigation.
  await qc.invalidateQueries({ queryKey: queryKeys.session, refetchType: 'all' });
  await qc.invalidateQueries({ queryKey: queryKeys.authConfig, refetchType: 'all' });
  await qc.invalidateQueries({ queryKey: queryKeys.workspaces, refetchType: 'all' });
}
