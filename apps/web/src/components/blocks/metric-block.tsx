import type { MetricBlock as MetricBlockT, Trend } from '@pulsedeck/schema';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDelta, formatMetric } from '@/lib/format';
import { BlockFrame } from './block-frame';

/**
 * metric — the instrument reading.
 *
 * Two independent channels (BLOCK_SCHEMA §1):
 *  - `trend` is GEOMETRY → the arrow direction only.
 *  - `sentiment` is MEANING → the colour of the delta only.
 * They are wired separately on purpose: latency up is negative, revenue up is
 * positive. We never colour by trend.
 */

const TREND_ICON: Record<Trend, typeof ArrowUpRight> = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: ArrowRight,
};

const SENTIMENT_TEXT: Record<string, string> = {
  positive: 'text-sentiment-positive',
  negative: 'text-sentiment-negative',
  neutral: 'text-sentiment-neutral',
};

export function MetricBlock({ block }: { block: MetricBlockT }) {
  const { value, suffix } = formatMetric(block.value, block.format, block.precision, block.unit);
  const TrendIcon = block.trend ? TREND_ICON[block.trend] : null;
  const sentimentClass = block.sentiment
    ? SENTIMENT_TEXT[block.sentiment]
    : 'text-muted-foreground';

  return (
    <BlockFrame title={block.title} caption={block.caption}>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{block.label}</span>
        <div className="flex items-end gap-2">
          <span className="tabular font-display text-display font-semibold leading-none tracking-tight text-foreground">
            {value}
            {suffix ? (
              <span className="ml-1 text-xl font-medium text-muted-foreground">{suffix}</span>
            ) : null}
          </span>
        </div>

        {block.delta !== undefined || block.comparison_label ? (
          <div className="mt-0.5 flex items-center gap-1.5 text-xs">
            {block.delta !== undefined ? (
              <span className={cn('inline-flex items-center gap-0.5 font-medium', sentimentClass)}>
                {TrendIcon ? <TrendIcon className="size-3.5" aria-hidden /> : null}
                <span className="tabular">
                  {formatDelta(block.delta, block.format, block.precision)}
                </span>
              </span>
            ) : TrendIcon ? (
              <TrendIcon className={cn('size-3.5', sentimentClass)} aria-hidden />
            ) : null}
            {block.comparison_label ? (
              <span className="text-muted-foreground">{block.comparison_label}</span>
            ) : null}
            {/* Sentiment is also conveyed as text for non-colour readers. */}
            {block.sentiment ? <span className="sr-only">({block.sentiment})</span> : null}
          </div>
        ) : null}
      </div>
    </BlockFrame>
  );
}
