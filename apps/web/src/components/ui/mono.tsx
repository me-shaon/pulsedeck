import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Machine-identifier text role. Use for agent-generated, machine-stable strings
 * only: source ids (src_…), api keys (pd_…), metric `key`s, ISO timestamps,
 * idempotency keys. JetBrains Mono + tabular figures = "this came from a machine".
 */
export interface MonoProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'span' | 'code' | 'div' | 'p';
}

const Mono = React.forwardRef<HTMLElement, MonoProps>(
  ({ as = 'span', className, ...props }, ref) => {
    const Comp = as as React.ElementType;
    return (
      <Comp
        ref={ref}
        className={cn('mono text-[0.95em] text-muted-foreground', className)}
        {...props}
      />
    );
  },
);
Mono.displayName = 'Mono';

export { Mono };
