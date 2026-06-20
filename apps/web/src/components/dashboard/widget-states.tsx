import { AlertTriangle, RefreshCw } from 'lucide-react';
import { errorMessage } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Compact loading / empty / error states sized for inside a widget card. Each
 * widget renders one of these independently so a single failing or empty widget
 * never blanks (or crashes) the surrounding grid.
 */

export function WidgetLoading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}

export function WidgetEmpty({ message = 'No data yet.' }: { message?: string }) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center px-2 py-6 text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

export function WidgetError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex min-h-24 flex-col items-center justify-center gap-2 px-2 py-5 text-center"
    >
      <AlertTriangle className="size-5 text-severity-warning" strokeWidth={1.75} aria-hidden />
      <p className="max-w-[16rem] text-xs text-muted-foreground">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" /> Retry
        </Button>
      ) : null}
    </div>
  );
}
