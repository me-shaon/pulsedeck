import { cn } from '@/lib/utils';

/**
 * Minimal toggle switch (role="switch"). Brand-filled when on, track-grey when
 * off; keyboard- and screen-reader-accessible. No external dep — matches the
 * other hand-rolled UI primitives.
 */
export function Switch({
  checked,
  onCheckedChange,
  id,
  disabled,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-border-strong',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 transform rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
