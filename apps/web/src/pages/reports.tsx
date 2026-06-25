import { getRouteApi } from '@tanstack/react-router';
import { searchToFilters, filtersToSearch } from '@/lib/report-search';
import { canManageReports, useCurrentWorkspace } from '@/lib/workspace-context';
import { useReportsInfinite } from '@/hooks/use-reports';
import { useReportCounts } from '@/hooks/use-report-counts';
import { useSources, useTree } from '@/hooks/use-workspace-data';
import { ReportList } from '@/components/report/report-list';
import { ReportFiltersBar } from '@/components/report/report-filters';
import { ScopeTabs } from '@/components/report/scope-tabs';
import { PageContainer, PageHeader } from '@/components/common/page';

const route = getRouteApi('/w/$ws/reports');

/** Workspace-wide "All Reports" feed with search + filters reflected in the URL. */
export function ReportsPage() {
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
        title="All reports"
        description="Everything pushed across this workspace, newest first."
      />
      <div className="mb-4">
        <ReportFiltersBar
          filters={filters}
          onChange={(next) => navigate({ search: filtersToSearch(next), replace: true })}
          sources={sources.data}
          tree={tree.data}
        />
      </div>
      <div className="mb-3">
        <ScopeTabs
          scope={filters.archived ?? 'active'}
          counts={counts.data}
          onChange={(archived) =>
            navigate({ search: filtersToSearch({ ...filters, archived }), replace: true })
          }
        />
      </div>
      <ReportList
        ws={workspace.slug}
        wsId={workspace.id}
        canManage={canManageReports(role)}
        scope={filters.archived ?? 'active'}
        query={query}
      />
    </PageContainer>
  );
}
