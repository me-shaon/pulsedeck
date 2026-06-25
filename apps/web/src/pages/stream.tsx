import { getRouteApi } from '@tanstack/react-router';
import { searchToFilters, filtersToSearch } from '@/lib/report-search';
import { canManageReports, useCurrentWorkspace } from '@/lib/workspace-context';
import { useReportsInfinite } from '@/hooks/use-reports';
import { useReportCounts } from '@/hooks/use-report-counts';
import { useSources, useTree, useWorkspaceTags } from '@/hooks/use-workspace-data';
import { ReportList } from '@/components/report/report-list';
import { ReportFiltersBar } from '@/components/report/report-filters';
import { PageContainer, PageHeader } from '@/components/common/page';

const route = getRouteApi('/w/$ws/stream/$streamId');

/** Per-stream feed — the same shared list, scoped to one stream. */
export function StreamPage() {
  const { workspace, role } = useCurrentWorkspace();
  const { streamId } = route.useParams();
  const navigate = route.useNavigate();
  const search = route.useSearch();
  const filters = searchToFilters(search);

  const tree = useTree(workspace.id);
  const sources = useSources(workspace.id);
  const tags = useWorkspaceTags(workspace.id);
  const query = useReportsInfinite({ wsId: workspace.id, filters, streamId });
  const counts = useReportCounts({ wsId: workspace.id, filters, streamId });

  const located = tree.data?.categories
    .flatMap((c) => c.streams.map((s) => ({ ...s, category: c.name })))
    .find((s) => s.id === streamId);

  return (
    <PageContainer>
      <PageHeader
        title={located?.name ?? 'Stream'}
        description={
          located
            ? `${located.category} · ${located.reportCount} reports`
            : 'Reports in this stream.'
        }
      />
      <div className="mb-4">
        <ReportFiltersBar
          filters={filters}
          onChange={(next) => navigate({ search: filtersToSearch(next), replace: true })}
          sources={sources.data}
          tree={tree.data}
          tags={tags.data}
          hideStreamFilter
        />
      </div>
      <ReportList
        ws={workspace.slug}
        wsId={workspace.id}
        canManage={canManageReports(role)}
        scope={filters.archived ?? 'active'}
        counts={counts.data}
        onScopeChange={(archived) =>
          navigate({ search: filtersToSearch({ ...filters, archived }), replace: true })
        }
        query={query}
        emptyTitle="No reports in this stream"
        emptyDescription="Reports pushed to this stream will appear here."
      />
    </PageContainer>
  );
}
