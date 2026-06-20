import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared wrapper that renders the common block envelope (`title`, `caption`)
 * around any block body. Keeps spacing + heading typography consistent across
 * all 8 renderers.
 */
export function BlockFrame({
  title,
  caption,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  caption?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {title || caption ? (
        <div className="flex flex-col gap-0.5">
          {title ? (
            <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
          ) : null}
          {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
