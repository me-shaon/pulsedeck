import { useInfiniteQuery } from '@tanstack/react-query';
import { listReports, listStreamReports } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { ReportFilters } from '@/lib/api-types';
import { useLiveInterval } from './use-live-updates';

/**
 * Cursor-paginated report feed, shared by the workspace "All Reports" view, the
 * per-stream feed, and Search. Newest-first; `nextCursor` drives "Load more".
 * Polls on the live interval (the SSE seam will later invalidate this key).
 */
export function useReportsInfinite({
  wsId,
  filters,
  streamId,
  enabled = true,
}: {
  wsId: string;
  filters: ReportFilters;
  streamId?: string;
  enabled?: boolean;
}) {
  const refetchInterval = useLiveInterval();
  return useInfiniteQuery({
    queryKey: queryKeys.reports(wsId, { streamId: streamId ?? null, filters }),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      streamId
        ? listStreamReports(wsId, streamId, filters, pageParam, 25, signal)
        : listReports(wsId, filters, pageParam, 25, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval,
  });
}
