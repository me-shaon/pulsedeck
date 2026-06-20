import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button, type ButtonProps } from '@/components/ui/button';

/**
 * Confirmation dialog for destructive / sensitive actions (rotate, revoke,
 * remove). Runs the async action, surfacing in-flight state and closing on
 * success; errors are left to the caller's toast.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  confirmVariant = 'destructive',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  confirmVariant?: ButtonProps['variant'];
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant={confirmVariant} onClick={confirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
