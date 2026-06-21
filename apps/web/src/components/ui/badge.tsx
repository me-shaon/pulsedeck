import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/*
 * Badge / pill.
 * Domain variants map to a tinted hue pair (soft bg + AA-safe text) defined in
 * tokens. Domain meaning is fixed to the enum — never the brand hue — so a
 * reader can trust the color. Tints come in both light + dark via CSS vars.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap tabular-nums',
  {
    variants: {
      variant: {
        neutral: 'bg-[var(--tint-gray-bg)] text-[var(--tint-gray-fg)]',
        brand: 'bg-[var(--tint-teal-bg)] text-[var(--tint-teal-fg)]',
        outline: 'border-border bg-transparent text-foreground',
        solid: 'bg-secondary text-secondary-foreground border-border',

        // severity
        info: 'bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]',
        warning: 'bg-[var(--tint-amber-bg)] text-[var(--tint-amber-fg)]',
        critical: 'bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)]',

        // status
        healthy: 'bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]',
        degraded: 'bg-[var(--tint-amber-bg)] text-[var(--tint-amber-fg)]',
        down: 'bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)]',
        unknown: 'bg-[var(--tint-gray-bg)] text-[var(--tint-gray-fg)]',

        // sentiment
        positive: 'bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]',
        negative: 'bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)]',
        neutralSentiment: 'bg-[var(--tint-gray-bg)] text-[var(--tint-gray-fg)]',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Show a leading colored dot (uses currentColor of the text). */
  dot?: boolean;
}

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current opacity-80" /> : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
