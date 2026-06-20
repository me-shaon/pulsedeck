import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReportCountConfig } from '@/lib/api-types';
import { useReportCount } from '@/hooks/use-dashboards';
import { formatLabel } from '@/lib/time';
import { WidgetEmpty, WidgetError, WidgetLoading } from '../widget-states';
import { axisProps, gridStroke, PRIMARY_SERIES, tooltipStyle } from './chart-theme';

/**
 * report_count widget — a small themed bar chart of bucketed report volume for a
 * stream or category. The bucket label is a truncated timestamp, formatted local.
 */
export function ReportCountWidget({
  wsId,
  config,
  title,
}: {
  wsId: string;
  config: ReportCountConfig;
  title: string;
}) {
  const q = useReportCount(wsId, {
    scope: config.scope,
    targetId: config.targetId,
    bucket: config.bucket,
    range: config.range,
  });

  if (q.isPending) return <WidgetLoading lines={4} />;
  if (q.isError) return <WidgetError error={q.error} onRetry={() => q.refetch()} />;

  const { buckets } = q.data;
  if (buckets.length === 0) return <WidgetEmpty message="No reports in this range." />;

  const data = buckets.map((b) => ({ label: formatLabel(b.bucket), count: b.count }));
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const summary = `Report volume for ${title}: ${total} reports across ${buckets.length} ${
    config.bucket === 'hour' ? 'hours' : 'days'
  }.`;

  return (
    <figure aria-label={summary} className="m-0">
      <p className="sr-only">{summary}</p>
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" {...axisProps} minTickGap={24} />
            <YAxis {...axisProps} width={32} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--accent)' }} />
            <Bar dataKey="count" fill={PRIMARY_SERIES} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">
        {total} total · per {config.bucket === 'hour' ? 'hour' : 'day'}
      </figcaption>
    </figure>
  );
}
