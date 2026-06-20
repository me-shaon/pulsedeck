import * as React from 'react';
import { cn } from '@/lib/utils';

/** Loading placeholder. Pulse is dampened under prefers-reduced-motion. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-2 motion-reduce:animate-none', className)}
      {...props}
    />
  );
}

export { Skeleton };
