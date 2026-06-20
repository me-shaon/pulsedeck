import { useEffect, useState } from 'react';
import type { DashboardListItem } from '@/lib/api-types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/components/common/states';

/**
 * Create / rename dialogs for dashboards. Both take a `name` (required) and an
 * optional `icon` string, run the async mutation, surface an inline error, and
 * close on success. The icon is a short free-text token (e.g. an emoji) — the
 * sidebar renders it verbatim when present.
 */

const fieldLabel = 'text-xs font-medium text-muted-foreground';

export function CreateDashboardDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; icon: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setIcon('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), icon: icon.trim() || null });
      onOpenChange(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New dashboard</DialogTitle>
          <DialogDescription>
            A new page of widgets. The first dashboard becomes the workspace default.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Name</span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="e.g. Operations"
              aria-label="Dashboard name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Icon (optional)</span>
            <Input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="e.g. 📊"
              aria-label="Dashboard icon"
              className="w-24"
            />
          </div>
          {error ? <p className="text-xs text-destructive">{errorMessage(error)}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create dashboard'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RenameDashboardDialog({
  open,
  onOpenChange,
  dashboard,
  onRename,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboard: Pick<DashboardListItem, 'name' | 'icon'>;
  onRename: (input: { name: string; icon: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState(dashboard.name);
  const [icon, setIcon] = useState(dashboard.icon ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setName(dashboard.name);
      setIcon(dashboard.icon ?? '');
      setError(null);
      setBusy(false);
    }
  }, [open, dashboard.name, dashboard.icon]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onRename({ name: name.trim(), icon: icon.trim() || null });
      onOpenChange(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename dashboard</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Name</span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              aria-label="Dashboard name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Icon (optional)</span>
            <Input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="e.g. 📊"
              aria-label="Dashboard icon"
              className="w-24"
            />
          </div>
          {error ? <p className="text-xs text-destructive">{errorMessage(error)}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
