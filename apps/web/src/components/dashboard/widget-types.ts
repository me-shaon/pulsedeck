import { Activity, BarChart3, Bell, Gauge, ListOrdered, type LucideIcon } from 'lucide-react';
import type { DashboardWidget, WidgetSpan, WidgetType } from '@/lib/api-types';

/**
 * Static metadata for the five widget types: a human label, an icon, and a
 * one-line description for the "add widget" picker. Kept in one place so the
 * builder, the grid, and the config form read consistent names.
 */
export interface WidgetTypeMeta {
  type: WidgetType;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const WIDGET_TYPES: WidgetTypeMeta[] = [
  {
    type: 'metric',
    label: 'Metric',
    icon: Gauge,
    description: 'Latest value of a metric key, with its delta vs the previous reading.',
  },
  {
    type: 'chart',
    label: 'Chart',
    icon: BarChart3,
    description: 'A line / bar / area time-series of a metric across reports.',
  },
  {
    type: 'report_count',
    label: 'Report volume',
    icon: Activity,
    description: 'Bucketed counts of reports for a stream or category over time.',
  },
  {
    type: 'stream_feed',
    label: 'Stream feed',
    icon: ListOrdered,
    description: 'The latest reports from a single stream.',
  },
  {
    type: 'alert_feed',
    label: 'Alert feed',
    icon: Bell,
    description: 'Recent warning / critical reports from a category.',
  },
];

const TYPE_META = new Map(WIDGET_TYPES.map((m) => [m.type, m]));

export function widgetTypeMeta(type: WidgetType): WidgetTypeMeta {
  return TYPE_META.get(type) ?? WIDGET_TYPES[0];
}

/**
 * Column-span → Tailwind class on the 12-column grid. Responsive: everything
 * stacks to full width on the smallest screens, then opens up to half / third.
 * The full literal strings are present so Tailwind generates them.
 */
export const SPAN_CLASS: Record<WidgetSpan, string> = {
  full: 'col-span-12',
  half: 'col-span-12 md:col-span-6',
  third: 'col-span-12 sm:col-span-6 lg:col-span-4',
};

export const SPAN_LABEL: Record<WidgetSpan, string> = {
  full: 'Full width',
  half: 'Half',
  third: 'Third',
};

export const SPAN_ORDER: WidgetSpan[] = ['full', 'half', 'third'];

/** A short, stable id for a freshly added widget (≤ 64 chars; layout schema cap). */
export function newWidgetId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `w_${rand}`.slice(0, 64);
}

/** The id a widget's config points at (stream or category), for title resolution. */
export function widgetTargetId(widget: DashboardWidget): string {
  switch (widget.type) {
    case 'stream_feed':
    case 'metric':
    case 'chart':
      return widget.config.streamId;
    case 'alert_feed':
      return widget.config.categoryId;
    case 'report_count':
      return widget.config.targetId;
  }
}
