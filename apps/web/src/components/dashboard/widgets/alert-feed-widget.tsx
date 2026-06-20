import { Link } from '@tanstack/react-router';
import type { AlertFeedConfig } from '@/lib/api-types';
import { useAlertFeed } from '@/hooks/use-dashboards';
import { Badge } from '@/components/ui/badge';
import { RelativeTime } from '@/components/common/relative-time';
import { severityVariant, titleCase } from '@/lib/domain';
import { WidgetEmpty, WidgetError, WidgetLoading } from '../widget-states';

/**
 * alert_feed widget — recent warning / critical reports from a category, newest
 * first. Compact rows (severity badge + title + when), each linking to the
 * report permalink.
 */
export function AlertFeedWidget({
  wsId,
  wsSlug,
  config,
}: {
  wsId: string;
  wsSlug: string;
  config: AlertFeedConfig;
}) {
  const q = useAlertFeed(wsId, config.categoryId, config.limit);

  if (q.isPending) return <WidgetLoading lines={3} />;
  if (q.isError) return <WidgetError error={q.error} onRetry={() => q.refetch()} />;

  const alerts = q.data;
  if (alerts.length === 0) return <WidgetEmpty message="No alerts — all quiet here." />;

  return (
    <ul className="flex flex-col gap-1.5">
      {alerts.map((alert) => (
        <li key={alert.id}>
          <Link
            to="/w/$ws/r/$reportId"
            params={{ ws: wsSlug, reportId: alert.id }}
            className="group flex items-start gap-2.5 rounded-md border border-border bg-surface px-3 py-2 transition-colors hover:border-border-strong hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {alert.severity ? (
              <Badge variant={severityVariant(alert.severity)} dot className="mt-0.5 shrink-0">
                {titleCase(alert.severity)}
              </Badge>
            ) : null}
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{alert.title}</span>
              <span className="text-[0.6875rem] text-muted-foreground">
                {alert.stream.name} · <RelativeTime value={alert.occurredAt} />
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
