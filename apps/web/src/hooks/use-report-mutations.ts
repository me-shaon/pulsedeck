import { useMutation, useQueryClient } from '@tanstack/react-query';
import { archiveReports, deleteReports, unarchiveReports } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

/**
 * Bulk report mutations: archive, unarchive, and hard-delete (the archive
 * feature). Each takes the selected report ids and, on success, invalidates the
 * `['reports', wsId]` query prefix so every affected list/feed refetches. (The
 * realtime SSE lifecycle events invalidate the same prefix for OTHER open tabs;
 * this covers the acting tab immediately without waiting for the round-trip.)
 */
export function useReportMutations(wsId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['reports', wsId] });

  const archive = useMutation({
    mutationFn: (ids: string[]) => archiveReports(wsId, ids),
    onSuccess: invalidate,
  });
  const unarchive = useMutation({
    mutationFn: (ids: string[]) => unarchiveReports(wsId, ids),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (ids: string[]) => deleteReports(wsId, ids),
    onSuccess: () => {
      void invalidate();
      // A deleted report's detail query can never resolve again — drop the tree
      // too so per-stream counts reflect the removal.
      void qc.invalidateQueries({ queryKey: queryKeys.tree(wsId) });
    },
  });

  return { archive, unarchive, remove };
}
