import type { ChartBlock as ChartBlockT } from '@pulsedeck/schema';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatLabel } from '@/lib/time';
import { BlockFrame } from './block-frame';

/**
 * chart — line / bar / area via Recharts, themed to design tokens. ISO-8601
 * x-labels are rendered as short local timestamps. Multiple series supported.
 *
 * Accessibility: charts are decorative-by-default to AT; we provide a concise
 * text summary (series names, point count) via an adjacent visually-hidden
 * description and an `aria-label` on the figure.
 */

// Distinct hues drawn from the semantic token set (kept away from the single
// brand accent so the chart reads as data, not chrome).
const SERIES_COLORS = [
  'var(--brand)',
  'var(--severity-info)',
  'var(--status-healthy)',
  'var(--severity-warning)',
  'var(--sentiment-negative)',
  'var(--status-unknown)',
] as const;

function seriesColor(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length];
}

export function ChartBlock({ block }: { block: ChartBlockT }) {
  const data = block.labels.map((label, i) => {
    const row: Record<string, string | number> = { label: formatLabel(label) };
    for (const s of block.series) {
      row[s.name] = s.data[i];
    }
    return row;
  });

  const summary = `${block.variant} chart, ${block.series.length} series (${block.series
    .map((s) => s.name)
    .join(', ')}), ${block.labels.length} points each${block.unit ? `, unit ${block.unit}` : ''}.`;

  const axisProps = {
    stroke: 'var(--muted)',
    fontSize: 11,
    tickLine: false,
    axisLine: { stroke: 'var(--border)' },
  } as const;

  const tooltipStyle = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    fontSize: 12,
    color: 'var(--ink)',
  } as const;

  // Recharts does not recurse into a React Fragment, so the shared axes/grid
  // are passed as a keyed ARRAY (which React.Children flattens) — never a <>.
  const common = [
    <CartesianGrid key="grid" stroke="var(--border)" strokeDasharray="3 3" vertical={false} />,
    <XAxis key="x" dataKey="label" {...axisProps} minTickGap={16} />,
    <YAxis key="y" {...axisProps} width={44} />,
    <Tooltip key="tip" contentStyle={tooltipStyle} cursor={{ stroke: 'var(--border-strong)' }} />,
    block.series.length > 1 ? <Legend key="legend" wrapperStyle={{ fontSize: 11 }} /> : null,
  ];

  return (
    <BlockFrame title={block.title} caption={block.caption}>
      <figure aria-label={summary} className="m-0">
        <p className="sr-only">{summary}</p>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {block.variant === 'bar' ? (
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {common}
                {block.series.map((s, i) => (
                  <Bar key={s.name} dataKey={s.name} fill={seriesColor(i)} radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            ) : block.variant === 'area' ? (
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {common}
                {block.series.map((s, i) => (
                  <Area
                    key={s.name}
                    type="monotone"
                    dataKey={s.name}
                    stroke={seriesColor(i)}
                    fill={seriesColor(i)}
                    fillOpacity={0.15}
                    strokeWidth={1.75}
                  />
                ))}
              </AreaChart>
            ) : (
              <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {common}
                {block.series.map((s, i) => (
                  <Line
                    key={s.name}
                    type="monotone"
                    dataKey={s.name}
                    stroke={seriesColor(i)}
                    strokeWidth={1.75}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
        {block.x_axis || block.y_axis ? (
          <figcaption className="mt-1 flex justify-between text-[0.6875rem] text-muted-foreground">
            <span>{block.y_axis}</span>
            <span>{block.x_axis}</span>
          </figcaption>
        ) : null}
      </figure>
    </BlockFrame>
  );
}
