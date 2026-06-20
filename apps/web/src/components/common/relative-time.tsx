import { absoluteTimeWithZone, relativeTime } from '@/lib/time';

/**
 * Renders a UTC timestamp as local relative time ("3 minutes ago") with the
 * full local absolute time (incl. zone) in the native tooltip + a machine-
 * readable `dateTime`.
 */
export function RelativeTime({ value, className }: { value: string; className?: string }) {
  return (
    <time dateTime={value} title={absoluteTimeWithZone(value)} className={className}>
      {relativeTime(value)}
    </time>
  );
}
