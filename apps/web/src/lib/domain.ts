import type { Severity, Status, Sentiment } from '@pulsedeck/schema';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * Maps domain enums to design-system badge variants + human labels. Centralized
 * so severity/status/sentiment always read consistently and color is never the
 * only signal (labels + icons accompany it everywhere).
 */

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const SEVERITY_VARIANT: Record<Severity, BadgeVariant> = {
  info: 'info',
  warning: 'warning',
  critical: 'critical',
};

const STATUS_VARIANT: Record<Status, BadgeVariant> = {
  healthy: 'healthy',
  degraded: 'degraded',
  down: 'down',
  unknown: 'unknown',
};

const SENTIMENT_VARIANT: Record<Sentiment, BadgeVariant> = {
  positive: 'positive',
  negative: 'negative',
  neutral: 'neutralSentiment',
};

export function severityVariant(severity: Severity): BadgeVariant {
  return SEVERITY_VARIANT[severity] ?? 'neutral';
}

export function statusVariant(status: Status): BadgeVariant {
  return STATUS_VARIANT[status] ?? 'unknown';
}

export function sentimentVariant(sentiment: Sentiment): BadgeVariant {
  return SENTIMENT_VARIANT[sentiment] ?? 'neutralSentiment';
}

/** Title-case a known enum value for display. */
export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The `status` token color class (for the small non-color-only dots). */
export const STATUS_DOT: Record<Status, string> = {
  healthy: 'bg-status-healthy',
  degraded: 'bg-status-degraded',
  down: 'bg-status-down',
  unknown: 'bg-status-unknown',
};

/** Source health → badge variant + label (active / stale / never / revoked). */
export const SOURCE_STATUS: Record<
  'active' | 'stale' | 'never' | 'revoked',
  { variant: BadgeVariant; label: string }
> = {
  active: { variant: 'healthy', label: 'Active' },
  stale: { variant: 'degraded', label: 'Stale' },
  never: { variant: 'unknown', label: 'Never connected' },
  revoked: { variant: 'neutral', label: 'Revoked' },
};
