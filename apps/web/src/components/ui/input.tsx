import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        data-ring="self"
        className={cn(
          'flex h-8 w-full rounded-md border border-input bg-surface px-2.5 text-sm text-foreground',
          'shadow-[inset_0_1px_0_0_rgba(0,0,0,0.02)] transition-colors',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
