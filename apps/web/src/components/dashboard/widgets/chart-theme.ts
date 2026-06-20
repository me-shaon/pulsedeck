/**
 * Shared Recharts theming for dashboard chart widgets, mirroring the Phase 8
 * `chart-block` so dashboard charts read identically to in-report charts. Values
 * are CSS custom properties so light/dark themes track automatically.
 */

export const axisProps = {
  stroke: 'var(--muted)',
  fontSize: 11,
  tickLine: false,
  axisLine: { stroke: 'var(--border)' },
} as const;

export const tooltipStyle = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--ink)',
} as const;

export const gridStroke = 'var(--border)';
export const cursorStroke = 'var(--border-strong)';

/** The primary series hue (data, not chrome — same brand accent as chart-block). */
export const PRIMARY_SERIES = 'var(--brand)';
