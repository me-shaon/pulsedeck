import { useEffect, useState } from 'react';
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
 * Create / rename dialogs for categories and streams. A single component serves
 * both entities (the labels differ); create mode shows the derived, permanent
 * slug, rename mode edits only the display name. The server owns final slug
 * derivation — this preview mirrors its algorithm so there are no surprises.
 */

const fieldLabel = 'text-xs font-medium text-muted-foreground';

/** Mirror of the server `slugify` in `apps/api/src/services/structure.ts`. */
export function slugifyPreview(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export type StructureKind = 'category' | 'stream';

export function StructureDialog({
  open,
  onOpenChange,
  kind,
  mode,
  initialName = '',
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: StructureKind;
  mode: 'create' | 'rename';
  initialName?: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setName(mode === 'rename' ? initialName : '');
      setError(null);
      setBusy(false);
    }
  }, [open, mode, initialName]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name.trim());
      onOpenChange(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const noun = kind === 'category' ? 'category' : 'stream';
  const title = `${mode === 'create' ? 'New' : 'Rename'} ${noun}`;
  const slug = slugifyPreview(name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {mode === 'create' ? (
            <DialogDescription>
              {kind === 'category'
                ? 'A top-level grouping. Agents push reports to its streams.'
                : 'A feed of reports inside this category.'}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Name</span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={kind === 'category' ? 'e.g. Infrastructure' : 'e.g. System Health'}
              aria-label={`${noun} name`}
            />
          </div>
          {mode === 'create' ? (
            <p className="text-[0.6875rem] text-muted-foreground">
              Slug: <code className="mono">{slug || '—'}</code> · permanent, agents push to this.
            </p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{errorMessage(error)}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : mode === 'create' ? `Create ${noun}` : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
