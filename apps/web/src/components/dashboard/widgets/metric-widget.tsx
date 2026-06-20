import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import type { MetricConfig } from '@/lib/api-types';
import { useMetricLatest } from '@/hooks/use-dashboards';
import { formatDelta, formatMetric } from '@/lib/format';
import { RelativeTime } from '@/components/common/relative-time';
import { Mono } from '@/components/ui/mono';
import { WidgetEmpty, WidgetError, WidgetLoading } from '../widget-states';

/**
 * metric widget — the instrument reading. Reuses the Phase 8 metric visual
 * language: a big tabular value + the delta vs the previous reading. The flat
 * `report_metrics` table carries no format/sentiment metadata, so the TREND
 * arrow is derived from the delta's sign (geometry) and the colour stays NEUTRAL
 * (we can't know if "up" is good or bad for an arbitrary key) — exactly the
 * "separate where derivable, else neutral" rule.
 */
export function MetricWidget({ wsId, config }: { wsId: string; config: MetricConfig }) {
  const q = useMetricLatest(wsId, config.streamId, config.metricKey);

  if (q.isPending) return <WidgetLoading lines={2} />;
  if (q.isError) return <WidgetError error={q.error} onRetry={() => q.refetch()} />;

  const { latest, previous, delta } = q.data;
  if (!latest) return <WidgetEmpty message="No readings yet." />;

  const { value, suffix } = formatMetric(latest.value, 'number');
  const TrendIcon =
    delta == null || delta === 0 ? ArrowRight : delta > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="flex flex-col gap-1">
      <Mono className="text-[0.6875rem]">{config.metricKey}</Mono>
      <div className="flex items-end gap-2">
        <span className="tabular text-display font-semibold leading-none tracking-tight text-foreground">
          {value}
          {suffix ? (
            <span className="ml-1 text-xl font-medium text-muted-foreground">{suffix}</span>
          ) : null}
        </span>
      </div>

      {delta != null && previous ? (
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-0.5 font-medium">
            <TrendIcon className="size-3.5" aria-hidden />
            <span className="tabular">{formatDelta(delta, 'number')}</span>
          </span>
          <span>vs previous</span>
        </div>
      ) : null}

      <div className="mt-1 text-[0.6875rem] text-muted-foreground">
        <RelativeTime value={latest.occurredAt} />
      </div>
    </div>
  );
}
