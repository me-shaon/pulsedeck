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
import { cn } from '@/lib/utils';

/**
 * Create / rename dialogs for dashboards. Both take a `name` (required) and an
 * optional `icon` string, run the async mutation, surface an inline error, and
 * close on success. The icon is a short token (an emoji) — the sidebar renders
 * it verbatim when present; the picker below just curates which emoji is stored.
 */

const fieldLabel = 'text-xs font-medium text-muted-foreground';

/** Curated emoji set for dashboard icons — covers the common ops/biz/eng themes. */
const DASHBOARD_ICONS = [
  '📊',
  '📈',
  '📉',
  '📋',
  '🗂️',
  '🧭',
  '🎯',
  '🚀',
  '⚙️',
  '🔧',
  '🛠️',
  '🚨',
  '🔔',
  '🛡️',
  '🔍',
  '🧪',
  '💰',
  '🛒',
  '💡',
  '🌐',
  '📦',
  '🩺',
  '🔥',
  '⭐',
];

/**
 * Click-to-pick emoji grid for the dashboard icon. Stores the chosen emoji as a
 * plain string (so existing string icons keep working); clicking the active one
 * clears it back to none, keeping the field optional.
 */
function IconPicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-1" role="group" aria-label="Dashboard icon">
      {DASHBOARD_ICONS.map((emoji) => {
        const active = value === emoji;
        return (
          <button
            key={emoji}
            type="button"
            aria-pressed={active}
            aria-label={active ? `Icon ${emoji}, selected` : `Icon ${emoji}`}
            onClick={() => onChange(active ? '' : emoji)}
            className={cn(
              'flex aspect-square items-center justify-center rounded-md border text-lg leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-brand bg-brand-tint'
                : 'border-border hover:border-border-strong hover:bg-surface-2/50',
            )}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}

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
            <IconPicker value={icon} onChange={setIcon} />
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
            <IconPicker value={icon} onChange={setIcon} />
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
