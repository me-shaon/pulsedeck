import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/common/copy-button';

export interface SecretRevealData {
  title: string;
  description?: string;
  /** The one-time secret (registration token or API key). */
  secret: string;
  secretLabel: string;
  /** Optional copyable agent setup instructions. */
  prompt?: string;
}

/**
 * Reveals a one-time secret with a clear "shown once" warning and copy buttons.
 * Used after creating a source / reissuing a token / rotating a key. The secret
 * is never persisted client-side beyond this dialog.
 */
export function SecretRevealDialog({
  data,
  onClose,
}: {
  data: SecretRevealData | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={data !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-xl">
        {data ? (
          <>
            <DialogHeader>
              <DialogTitle>{data.title}</DialogTitle>
              {data.description ? <DialogDescription>{data.description}</DialogDescription> : null}
            </DialogHeader>

            <div className="flex items-start gap-2 rounded-md border border-[var(--severity-warning)]/40 bg-[var(--tint-amber-bg)] px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-severity-warning" aria-hidden />
              <span className="text-foreground">
                Shown once. Copy it now — you won’t be able to see it again.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
                {data.secretLabel}
              </span>
              <div className="flex items-center gap-2">
                <code className="mono min-w-0 flex-1 truncate rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs">
                  {data.secret}
                </code>
                <CopyButton value={data.secret} label="Copy" />
              </div>
            </div>

            {data.prompt ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
                    Agent setup prompt
                  </span>
                  <CopyButton value={data.prompt} label="Copy prompt" size="sm" variant="ghost" />
                </div>
                <pre className="mono max-h-64 overflow-auto rounded-md border border-border bg-surface-2 p-3 text-[0.6875rem] leading-relaxed whitespace-pre-wrap">
                  {data.prompt}
                </pre>
              </div>
            ) : null}

            <DialogFooter>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
