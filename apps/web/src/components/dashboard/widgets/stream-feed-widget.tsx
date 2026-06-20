import type { StreamFeedConfig } from '@/lib/api-types';
import { useStreamFeed } from '@/hooks/use-dashboards';
import { ReportRow } from '@/components/report/report-row';
import { WidgetEmpty, WidgetError, WidgetLoading } from '../widget-states';

/**
 * stream_feed widget — the latest N reports of a stream, reusing the shared
 * ReportRow so each entry links straight to the report permalink.
 */
export function StreamFeedWidget({
  wsId,
  wsSlug,
  config,
}: {
  wsId: string;
  wsSlug: string;
  config: StreamFeedConfig;
}) {
  const q = useStreamFeed(wsId, config.streamId, config.limit);

  if (q.isPending) return <WidgetLoading lines={3} />;
  if (q.isError) return <WidgetError error={q.error} onRetry={() => q.refetch()} />;

  const reports = q.data.slice(0, config.limit);
  if (reports.length === 0) return <WidgetEmpty message="No reports in this stream yet." />;

  return (
    <div className="flex flex-col gap-2">
      {reports.map((report) => (
        <ReportRow key={report.id} ws={wsSlug} report={report} />
      ))}
    </div>
  );
}
