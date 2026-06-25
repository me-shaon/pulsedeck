import { useQuery } from '@tanstack/react-query';
import { getReportCounts, getStreamReportCounts } from '@/lib/api';
import type { ReportFilters } from '@/lib/api-types';
import { useLiveInterval } from './use-live-updates';

/**
 * Active vs. archived report counts for the Active/Archived tabs. The `archived`
 * scope is stripped before querying — counts are identical across tabs, so one
 * cache entry serves both and switching tabs never refetches. Lives under the
 * `['reports', wsId]` key prefix so report mutations and realtime lifecycle
 * events invalidate it alongside the feeds.
 */
export function useReportCounts({
  wsId,
  filters,
  streamId,
}: {
  wsId: string;
  filters: ReportFilters;
  streamId?: string;
}) {
  const refetchInterval = useLiveInterval();
  const countFilters: ReportFilters = { ...filters, archived: undefined };
  return useQuery({
    queryKey: ['reports', wsId, 'counts', { streamId: streamId ?? null, filters: countFilters }],
    queryFn: ({ signal }) =>
      streamId
        ? getStreamReportCounts(wsId, streamId, countFilters, signal)
        : getReportCounts(wsId, countFilters, signal),
    refetchInterval,
  });
}
