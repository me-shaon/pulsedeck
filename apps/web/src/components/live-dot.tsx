import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * Live-pulse dot for active sources. A small solid dot with a soft expanding
 * halo (the halo is frozen under prefers-reduced-motion via the CSS rule).
 *
 * Color defaults to the brand "pulse" hue, but accepts a status color so it can
 * sit next to a source row and mean "healthy + live", etc.
 */
const colorMap = {
  brand: 'text-brand',
  healthy: 'text-status-healthy',
  degraded: 'text-status-degraded',
  down: 'text-status-down',
  info: 'text-severity-info',
} as const;

export interface LiveDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: keyof typeof colorMap;
  /** When false, no halo (idle dot). */
  live?: boolean;
  size?: number;
}

export function LiveDot({
  color = 'brand',
  live = true,
  size = 8,
  className,
  ...props
}: LiveDotProps) {
  return (
    <span
      className={cn('relative inline-flex shrink-0', colorMap[color], className)}
      style={{ width: size, height: size }}
      {...props}
    >
      {live ? (
        <span
          aria-hidden
          className="live-ping absolute inset-0 rounded-full bg-current motion-reduce:hidden"
        />
      ) : null}
      <span className="relative inline-block size-full rounded-full bg-current" />
    </span>
  );
}
