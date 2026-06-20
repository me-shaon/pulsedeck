import { Inbox } from 'lucide-react';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { ReportPage } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, SkeletonRows } from '@/components/common/states';
import { ReportRow } from './report-row';

// pageParam is `unknown` to match what `useInfiniteQuery` infers for the shared
// feed hook (the cursor type isn't surfaced through the result generic).
type Query = UseInfiniteQueryResult<InfiniteData<ReportPage, unknown>, Error>;

/**
 * Shared report feed renderer. Drives the workspace "All Reports" view, the
 * per-stream feed, and Search from one infinite query — handling loading,
 * empty, and error states plus cursor-based "Load more".
 */
export function ReportList({
  ws,
  query,
  emptyTitle = 'No reports yet',
  emptyDescription = 'Reports pushed by your connected agents will appear here, newest first.',
}: {
  ws: string;
  query: Query;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (query.isPending) return <SkeletonRows rows={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const reports = query.data.pages.flatMap((p) => p.reports);

  if (reports.length === 0) {
    return <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* aria-busy reflects a background refetch (poll) without blocking reads. */}
      <div
        className="flex flex-col gap-2"
        aria-busy={query.isFetching && !query.isFetchingNextPage}
      >
        {reports.map((report) => (
          <ReportRow key={report.id} ws={ws} report={report} />
        ))}
      </div>

      {query.hasNextPage ? (
        <div className="flex justify-center py-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : (
        <p className="py-2 text-center text-[0.6875rem] text-muted-foreground">
          {reports.length} report{reports.length === 1 ? '' : 's'} · end of feed
        </p>
      )}
    </div>
  );
}
