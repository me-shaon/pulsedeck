import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCategory,
  createStream,
  deleteCategory,
  deleteStream,
  getCategoryInstructions,
  getReport,
  getStreamInstructions,
  getTree,
  listSources,
  listWorkspaces,
  renameCategory,
  renameStream,
  reorderCategories,
  reorderStreams,
} from '@/lib/api';
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

/**
 * Category/stream management mutations. Each invalidates the tree query so the
 * sidebar reflects the change. Reorder mutations apply an optimistic update of
 * the tree cache so dragging feels instant, rolling back on error.
 */
export function useStructureMutations(wsId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.tree(wsId) });

  const create = useMutation({
    mutationFn: (input: { name: string; slug?: string }) => createCategory(wsId, input),
    onSuccess: invalidate,
  });
  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) => renameCategory(wsId, input.id, input.name),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (categoryId: string) => deleteCategory(wsId, categoryId),
    onSuccess: invalidate,
  });
  const createStreamM = useMutation({
    mutationFn: (input: { categoryId: string; name: string; slug?: string }) =>
      createStream(wsId, input.categoryId, { name: input.name, slug: input.slug }),
    onSuccess: invalidate,
  });
  const renameStreamM = useMutation({
    mutationFn: (input: { id: string; name: string }) => renameStream(wsId, input.id, input.name),
    onSuccess: invalidate,
  });
  const removeStreamM = useMutation({
    mutationFn: (streamId: string) => deleteStream(wsId, streamId),
    onSuccess: invalidate,
  });
  const reorderCategoriesM = useMutation({
    mutationFn: (ids: string[]) => reorderCategories(wsId, ids),
    onSuccess: invalidate,
  });
  const reorderStreamsM = useMutation({
    mutationFn: (input: { categoryId: string; ids: string[] }) =>
      reorderStreams(wsId, input.categoryId, input.ids),
    onSuccess: invalidate,
  });

  return {
    createCategory: create,
    renameCategory: rename,
    deleteCategory: remove,
    createStream: createStreamM,
    renameStream: renameStreamM,
    deleteStream: removeStreamM,
    reorderCategories: reorderCategoriesM,
    reorderStreams: reorderStreamsM,
  };
}

/**
 * Fetch destination-scoped agent instructions on demand. Modelled as a mutation
 * (not a query) because each call mints a fresh one-time registration token.
 */
export function useAgentInstructions(wsId: string) {
  return useMutation({
    mutationFn: (target: { kind: 'category' | 'stream'; id: string; sourceId: string }) =>
      target.kind === 'stream'
        ? getStreamInstructions(wsId, target.id, target.sourceId)
        : getCategoryInstructions(wsId, target.id, target.sourceId),
  });
}
