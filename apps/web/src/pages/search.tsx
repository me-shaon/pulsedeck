import { getRouteApi } from '@tanstack/react-router';
import { searchToFilters, filtersToSearch } from '@/lib/report-search';
import { canManageReports, useCurrentWorkspace } from '@/lib/workspace-context';
import { useReportsInfinite } from '@/hooks/use-reports';
import { useReportCounts } from '@/hooks/use-report-counts';
import { useSources, useTree } from '@/hooks/use-workspace-data';
import { ReportList } from '@/components/report/report-list';
import { ReportFiltersBar } from '@/components/report/report-filters';
import { PageContainer, PageHeader } from '@/components/common/page';

const route = getRouteApi('/w/$ws/search');

/**
 * Search — the same feed + filter machinery as All Reports, framed as a query
 * surface. Full-text `q` plus the full filter set, all in the URL.
 */
export function SearchPage() {
  const { workspace, role } = useCurrentWorkspace();
  const navigate = route.useNavigate();
  const search = route.useSearch();
  const filters = searchToFilters(search);

  const query = useReportsInfinite({ wsId: workspace.id, filters });
  const counts = useReportCounts({ wsId: workspace.id, filters });
  const sources = useSources(workspace.id);
  const tree = useTree(workspace.id);

  return (
    <PageContainer>
      <PageHeader
        title="Search"
        description="Search and filter across every report in the workspace."
      />
      <div className="mb-4">
        <ReportFiltersBar
          filters={filters}
          onChange={(next) => navigate({ search: filtersToSearch(next), replace: true })}
          sources={sources.data}
          tree={tree.data}
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
        emptyTitle="No matching reports"
        emptyDescription="Try a different search term or relax the filters."
      />
    </PageContainer>
  );
}
