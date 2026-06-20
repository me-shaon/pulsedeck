import { useQuery } from '@tanstack/react-query';
import { getReport, getTree, listSources, listWorkspaces } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { useLiveInterval } from './use-live-updates';

/** All workspaces the signed-in user belongs to (drives the switcher). */
export function useWorkspaces() {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: ({ signal }) => listWorkspaces(signal),
    select: (r) => r.workspaces,
  });
}

/** The category → stream tree for a workspace (drives the sidebar). */
export function useTree(wsId: string) {
  const refetchInterval = useLiveInterval();
  return useQuery({
    queryKey: queryKeys.tree(wsId),
    queryFn: ({ signal }) => getTree(wsId, signal),
    refetchInterval,
  });
}

/** Connected agents for a workspace. */
export function useSources(wsId: string, enabled = true) {
  const refetchInterval = useLiveInterval();
  return useQuery({
    queryKey: queryKeys.sources(wsId),
    queryFn: ({ signal }) => listSources(wsId, signal),
    select: (r) => r.sources,
    enabled,
    refetchInterval,
  });
}

/** A single report with its prev/next neighbours in the stream. */
export function useReport(wsId: string, reportId: string) {
  const refetchInterval = useLiveInterval();
  return useQuery({
    queryKey: queryKeys.report(wsId, reportId),
    queryFn: ({ signal }) => getReport(wsId, reportId, signal),
    refetchInterval,
  });
}
