import type { ColumnType, Format } from '@pulsedeck/schema';

/**
 * Number / value formatting for metric and table blocks.
 *
 * The metric renderer wants the numeric body and its unit *separately* (the
 * unit is set in smaller type), so {@link formatMetric} returns a `{ value,
 * suffix }` pair. Table cells want one string, so {@link formatCell} flattens.
 *
 * `trend` (geometry / arrow) and `sentiment` (color) are intentionally NOT
 * handled here — they live in the metric renderer.
 */

function numberFormat(value: number, precision?: number): string {
  const opts: Intl.NumberFormatOptions =
    precision === undefined
      ? { maximumFractionDigits: 2 }
      : { minimumFractionDigits: precision, maximumFractionDigits: precision };
  return new Intl.NumberFormat(undefined, opts).format(value);
}

function currencyFormat(value: number, precision?: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: precision ?? 2,
    maximumFractionDigits: precision ?? 2,
  }).format(value);
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** Humanize a byte count into `{ num, unit }` (1024-base). */
export function humanizeBytes(bytes: number, precision?: number): { num: string; unit: string } {
  if (!Number.isFinite(bytes)) return { num: String(bytes), unit: 'B' };
  const sign = bytes < 0 ? '-' : '';
  let n = Math.abs(bytes);
  let i = 0;
  while (n >= 1024 && i < BYTE_UNITS.length - 1) {
    n /= 1024;
    i += 1;
  }
  const digits = precision ?? (i === 0 ? 0 : n >= 100 ? 0 : n >= 10 ? 1 : 2);
  return { num: sign + numberFormat(n, digits), unit: BYTE_UNITS[i] };
}

export interface FormattedMetric {
  /** The primary numeric body. */
  value: string;
  /** A small unit suffix to render alongside, if any. */
  suffix?: string;
}

/**
 * Format a metric value honoring its `format` and `precision`. Returns the
 * numeric body and an optional unit suffix so the renderer can style them
 * separately (big tabular value + small unit).
 */
export function formatMetric(
  value: number,
  format: Format = 'number',
  precision?: number,
  unit?: string,
): FormattedMetric {
  switch (format) {
    case 'currency':
      return { value: currencyFormat(value, precision) };
    case 'percent':
      return { value: `${numberFormat(value, precision ?? 1)}%` };
    case 'bytes': {
      const { num, unit: byteUnit } = humanizeBytes(value, precision);
      return { value: num, suffix: byteUnit };
    }
    case 'duration':
    case 'number':
    default:
      return { value: numberFormat(value, precision), suffix: unit || undefined };
  }
}

/** Format a signed delta for display (keeps an explicit sign). */
export function formatDelta(delta: number, format: Format = 'number', precision?: number): string {
  const sign = delta > 0 ? '+' : '';
  const { value, suffix } = formatMetric(Math.abs(delta), format, precision);
  const body = delta < 0 ? `-${value}` : `${sign}${value}`;
  return suffix ? `${body} ${suffix}` : body;
}

/**
 * Format a single table cell value according to its column `type` and optional
 * `unit`. Used for *display only* — sorting uses the raw value (see sort util).
 */
export function formatCell(value: unknown, type: ColumnType, unit?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return String(value);
    const body = numberFormat(n);
    return unit ? `${body} ${unit}` : body;
  }
  if (type === 'date') {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }
  return String(value);
}
