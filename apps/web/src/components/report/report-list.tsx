import { useMemo, useState } from 'react';
import { CheckSquare, Inbox } from 'lucide-react';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { ArchiveScope, ReportPage } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, SkeletonRows } from '@/components/common/states';
import { BulkActionBar } from './bulk-action-bar';
import { ReportRow } from './report-row';
import { ScopeTabs } from './scope-tabs';

// pageParam is `unknown` to match what `useInfiniteQuery` infers for the shared
// feed hook (the cursor type isn't surfaced through the result generic).
type Query = UseInfiniteQueryResult<InfiniteData<ReportPage, unknown>, Error>;

/**
 * Shared report feed renderer. Drives the workspace "All Reports" view, the
 * per-stream feed, and Search from one infinite query — handling loading,
 * empty, and error states plus cursor-based "Load more".
 *
 * It also owns the single header band above the feed: on the left the
 * Active/Archived scope tabs, on the right the Select entry. Entering selection
 * mode morphs that whole band into the bulk action bar. Keeping both halves in
 * one component is what keeps the row aligned and the rhythm coherent.
 */
export function ReportList({
  ws,
  query,
  wsId,
  canManage = false,
  scope = 'active',
  counts,
  onScopeChange,
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
  /** Active/archived counts for the scope tabs. Omit to hide the tabs. */
  counts?: { active: number; archived: number };
  /** Change the archive scope (drives the tabs). Omit to hide the tabs. */
  onScopeChange?: (scope: ArchiveScope | undefined) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const selectable = canManage && wsId !== undefined;
  const showTabs = onScopeChange !== undefined;

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
  // Selection is "engaged" once the user enters selection mode (the Select
  // button). Only then do rows show a checkbox — the reading view stays flush.
  const selectionActive = selectable && (selectionMode || selectedVisible.length > 0);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllVisible() {
    setSelected(new Set(visibleIds));
  }
  // Exit selection mode entirely: drop the selection and the mode flag.
  function exitSelection() {
    setSelected(new Set());
    setSelectionMode(false);
  }

  if (query.isPending) return <SkeletonRows rows={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  // The header band morphs: tabs + Select while reading, the action bar while
  // selecting. Rendered even on an empty feed so the tabs (and their counts)
  // never disappear when a filter or scope yields nothing.
  const header = selectionActive ? (
    <BulkActionBar
      wsId={wsId!}
      ids={selectedVisible}
      scope={scope}
      visibleCount={reports.length}
      onSelectAll={selectAllVisible}
      onExit={exitSelection}
    />
  ) : showTabs || selectable ? (
    <div className="flex items-center justify-between gap-3">
      {showTabs ? <ScopeTabs scope={scope} counts={counts} onChange={onScopeChange} /> : <span />}
      {selectable ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setSelectionMode(true)}
        >
          <CheckSquare className="mr-1" /> Select
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      {header}

      {reports.length === 0 ? (
        <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
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
                selectionActive={selectionActive}
                onToggleSelect={toggle}
              />
            ))}
          </div>

          {query.hasNextPage ? (
            <div className="flex justify-center py-1">
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
            <p className="py-1 text-center text-[0.6875rem] text-muted-foreground">
              {reports.length} report{reports.length === 1 ? '' : 's'} · end of feed
            </p>
          )}
        </>
      )}
    </div>
  );
}
