import { useMemo, useState } from 'react';
import { CheckSquare, Inbox } from 'lucide-react';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { ArchiveScope, ReportPage } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, SkeletonRows } from '@/components/common/states';
import { BulkActionBar } from './bulk-action-bar';
import { ReportRow } from './report-row';

// pageParam is `unknown` to match what `useInfiniteQuery` infers for the shared
// feed hook (the cursor type isn't surfaced through the result generic).
type Query = UseInfiniteQueryResult<InfiniteData<ReportPage, unknown>, Error>;

/**
 * Shared report feed renderer. Drives the workspace "All Reports" view, the
 * per-stream feed, and Search from one infinite query — handling loading,
 * empty, and error states plus cursor-based "Load more".
 *
 * When `wsId` and `canManage` are supplied, each row becomes selectable and a
 * bulk action bar (archive/unarchive/delete) appears while any are selected.
 * `scope` tells the bar whether the primary action is Archive or Unarchive.
 */
export function ReportList({
  ws,
  query,
  wsId,
  canManage = false,
  scope = 'active',
  emptyTitle = 'No reports yet',
  emptyDescription = 'Reports pushed by your connected agents will appear here, newest first.',
}: {
  ws: string;
  query: Query;
  /** Workspace id — required for bulk mutations (distinct from `ws`, the slug). */
  wsId?: string;
  /** Whether the current user may archive/delete (editor+). Hides the controls otherwise. */
  canManage?: boolean;
  /** The list's archive scope, so the bar shows Archive vs. Unarchive. */
  scope?: ArchiveScope;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectable = canManage && wsId !== undefined;

  const reports = useMemo(
    () => (query.data ? query.data.pages.flatMap((p) => p.reports) : []),
    [query.data],
  );

  // Selection can only reference reports currently in the feed — prune ids that
  // scrolled out or were just mutated away so the bar count stays truthful.
  const visibleIds = useMemo(() => new Set(reports.map((r) => r.id)), [reports]);
  const selectedVisible = useMemo(
    () => [...selected].filter((id) => visibleIds.has(id)),
    [selected, visibleIds],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clear() {
    setSelected(new Set());
  }
  function selectAllVisible() {
    setSelected(new Set(visibleIds));
  }

  if (query.isPending) return <SkeletonRows rows={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  if (reports.length === 0) {
    return <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {selectable && selectedVisible.length > 0 ? (
        <BulkActionBar wsId={wsId} ids={selectedVisible} scope={scope} onClear={clear} />
      ) : null}

      {selectable && selectedVisible.length === 0 ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={selectAllVisible}>
            <CheckSquare className="mr-1" /> Select all
          </Button>
        </div>
      ) : null}

      {/* aria-busy reflects a background refetch (poll) without blocking reads. */}
      <div
        className="flex flex-col gap-3"
        aria-busy={query.isFetching && !query.isFetchingNextPage}
      >
        {reports.map((report) => (
          <ReportRow
            key={report.id}
            ws={ws}
            report={report}
            selectable={selectable}
            selected={selected.has(report.id)}
            onToggleSelect={toggle}
          />
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
