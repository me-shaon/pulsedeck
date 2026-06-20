import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartConfig } from '@/lib/api-types';
import { useMetricSeries } from '@/hooks/use-dashboards';
import { formatLabel } from '@/lib/time';
import { WidgetEmpty, WidgetError, WidgetLoading } from '../widget-states';
import { axisProps, cursorStroke, gridStroke, PRIMARY_SERIES, tooltipStyle } from './chart-theme';

/**
 * chart widget — a metric time-series rendered with the same themed Recharts
 * setup as the Phase 8 chart-block (line / bar / area). Carries an accessible
 * text summary (variant, point count) for AT, mirroring chart-block's pattern.
 */
export function ChartWidget({
  wsId,
  config,
  title,
}: {
  wsId: string;
  config: ChartConfig;
  title: string;
}) {
  const q = useMetricSeries(wsId, config.streamId, config.metricKey, config.range);

  if (q.isPending) return <WidgetLoading lines={4} />;
  if (q.isError) return <WidgetError error={q.error} onRetry={() => q.refetch()} />;

  const { points, truncated } = q.data;
  if (points.length === 0) return <WidgetEmpty message="No data points in this range." />;

  const data = points.map((p) => ({ label: formatLabel(p.occurredAt), value: p.value }));
  const summary = `${config.variant} chart of ${config.metricKey} for ${title}, ${points.length} points${
    truncated ? ' (truncated)' : ''
  }.`;

  const common = [
    <CartesianGrid key="grid" stroke={gridStroke} strokeDasharray="3 3" vertical={false} />,
    <XAxis key="x" dataKey="label" {...axisProps} minTickGap={24} />,
    <YAxis key="y" {...axisProps} width={40} />,
    <Tooltip key="tip" contentStyle={tooltipStyle} cursor={{ stroke: cursorStroke }} />,
  ];

  return (
    <figure aria-label={summary} className="m-0">
      <p className="sr-only">{summary}</p>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {config.variant === 'bar' ? (
            <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              {common}
              <Bar dataKey="value" fill={PRIMARY_SERIES} radius={[2, 2, 0, 0]} />
            </BarChart>
          ) : config.variant === 'area' ? (
            <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              {common}
              <Area
                type="monotone"
                dataKey="value"
                stroke={PRIMARY_SERIES}
                fill={PRIMARY_SERIES}
                fillOpacity={0.15}
                strokeWidth={1.75}
              />
            </AreaChart>
          ) : (
            <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              {common}
              <Line
                type="monotone"
                dataKey="value"
                stroke={PRIMARY_SERIES}
                strokeWidth={1.75}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      {truncated ? (
        <figcaption className="mt-1 text-[0.6875rem] text-muted-foreground">
          Showing the earliest points in range.
        </figcaption>
      ) : null}
    </figure>
  );
}
