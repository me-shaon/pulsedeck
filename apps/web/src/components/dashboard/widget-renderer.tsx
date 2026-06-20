import type { DashboardWidget } from '@/lib/api-types';
import { MetricWidget } from './widgets/metric-widget';
import { ChartWidget } from './widgets/chart-widget';
import { ReportCountWidget } from './widgets/report-count-widget';
import { StreamFeedWidget } from './widgets/stream-feed-widget';
import { AlertFeedWidget } from './widgets/alert-feed-widget';

/**
 * Dispatch a widget to its renderer. Each renderer owns its own data hook and
 * loading/empty/error states; the surrounding `WidgetErrorBoundary` (in the
 * shell) catches any synchronous render crash so one widget can't blank the grid.
 */
export function WidgetRenderer({
  wsId,
  wsSlug,
  widget,
  title,
}: {
  wsId: string;
  wsSlug: string;
  widget: DashboardWidget;
  title: string;
}) {
  switch (widget.type) {
    case 'metric':
      return <MetricWidget wsId={wsId} config={widget.config} />;
    case 'chart':
      return <ChartWidget wsId={wsId} config={widget.config} title={title} />;
    case 'report_count':
      return <ReportCountWidget wsId={wsId} config={widget.config} title={title} />;
    case 'stream_feed':
      return <StreamFeedWidget wsId={wsId} wsSlug={wsSlug} config={widget.config} />;
    case 'alert_feed':
      return <AlertFeedWidget wsId={wsId} wsSlug={wsSlug} config={widget.config} />;
  }
}
