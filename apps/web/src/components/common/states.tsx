import { AlertTriangle, RefreshCw } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Turn any thrown value into an actionable, in-voice message. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "You don't have access to this.";
    if (error.status === 404) return 'Not found — it may have been removed.';
    if (error.status === 0) return 'Could not reach the server. Check your connection.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

/** Inline error panel with an optional retry. */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface/40 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full border border-border bg-surface-2 text-severity-warning">
        <AlertTriangle className="size-5" strokeWidth={1.75} aria-hidden />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">Couldn’t load this</p>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">
          {errorMessage(error)}
        </p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" /> Retry
        </Button>
      ) : null}
    </div>
  );
}

/** A column of skeleton rows for list loading states. */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3.5"
        >
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-14 rounded-full" />
          </div>
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}
