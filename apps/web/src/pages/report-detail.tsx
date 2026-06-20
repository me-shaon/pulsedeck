import { getRouteApi } from '@tanstack/react-router';
import { useCurrentWorkspace } from '@/lib/workspace-context';
import { useReport } from '@/hooks/use-workspace-data';
import { BlockList } from '@/components/blocks/registry';
import { PrevNextNav, ReportMetaHeader } from '@/components/report/report-meta-header';
import { ErrorState } from '@/components/common/states';
import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer } from '@/components/common/page';

const route = getRouteApi('/w/$ws/r/$reportId');

/**
 * Report permalink (`/w/:ws/r/:reportId`). Metadata header + flat sequential
 * blocks (rendered by the registry in the order received) + prev/next within
 * the stream.
 */
export function ReportDetailPage() {
  const { workspace } = useCurrentWorkspace();
  const { reportId } = route.useParams();
  const query = useReport(workspace.id, reportId);

  if (query.isPending) {
    return (
      <PageContainer>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (query.isError) {
    return (
      <PageContainer>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </PageContainer>
    );
  }

  const { report, prevReportId, nextReportId } = query.data;

  return (
    <PageContainer>
      <article className="flex flex-col gap-6">
        <ReportMetaHeader ws={workspace.slug} report={report} />
        {report.blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">This report has no blocks.</p>
        ) : (
          <BlockList blocks={report.blocks} />
        )}
        <div className="border-t border-border pt-5">
          <PrevNextNav
            ws={workspace.slug}
            prevReportId={prevReportId}
            nextReportId={nextReportId}
          />
        </div>
      </article>
    </PageContainer>
  );
}
