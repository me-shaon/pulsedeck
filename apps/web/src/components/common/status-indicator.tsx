import type { Status } from '@pulsedeck/schema';
import { cn } from '@/lib/utils';
import { STATUS_DOT, titleCase } from '@/lib/domain';

/**
 * Non-color-only status treatment: a colored dot PLUS an always-present text
 * label (visible or screen-reader). Colour is reinforced by the word, never the
 * sole carrier of meaning (Phase 7 accessibility guarantee).
 */
export function StatusIndicator({
  status,
  showLabel = true,
  className,
}: {
  status: Status;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        aria-hidden
        className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[status] ?? 'bg-status-unknown')}
      />
      {showLabel ? (
        <span className="text-sm">{titleCase(status)}</span>
      ) : (
        <span className="sr-only">status: {status}</span>
      )}
    </span>
  );
}
