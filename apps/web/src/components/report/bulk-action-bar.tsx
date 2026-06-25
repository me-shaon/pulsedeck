import { useState } from 'react';
import { Archive, ArchiveRestore, CheckSquare, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ArchiveScope } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { useReportMutations } from '@/hooks/use-report-mutations';

type Pending = 'toggle' | 'delete' | null;

/**
 * Selection-mode toolbar. Rendered whenever selection is engaged (the user
 * entered selection mode or selected a row), so it also works as the "0
 * selected" chrome with Select-all + exit. Archive/unarchive and delete each go
 * through a confirm dialog; the primary action flips by the list's scope.
 */
export function BulkActionBar({
  wsId,
  ids,
  scope,
  visibleCount,
  onSelectAll,
  onExit,
}: {
  wsId: string;
  ids: string[];
  /** The list's current archive scope — decides archive vs. unarchive. */
  scope: ArchiveScope;
  /** Total rows currently in the feed (drives the Select-all affordance). */
  visibleCount: number;
  onSelectAll: () => void;
  /** Clear the selection and leave selection mode. */
  onExit: () => void;
}) {
  const { archive, unarchive, remove } = useReportMutations(wsId);
  const [pending, setPending] = useState<Pending>(null);
  const count = ids.length;
  const noun = count === 1 ? 'report' : 'reports';
  const busy = archive.isPending || unarchive.isPending || remove.isPending;
  const inArchivedView = scope === 'archived';
  const toggleVerb = inArchivedView ? 'unarchive' : 'archive';
  const allSelected = count > 0 && count >= visibleCount;
  const hasSelection = count > 0;

  async function runToggle() {
    const mutation = inArchivedView ? unarchive : archive;
    const res = await mutation.mutateAsync(ids);
    toast.success(`${res.affected} ${noun} ${inArchivedView ? 'unarchived' : 'archived'}`);
    onExit();
  }

  async function runDelete() {
    const res = await remove.mutateAsync(ids);
    toast.success(`${res.affected} ${noun} deleted`);
    onExit();
  }

  const isDelete = pending === 'delete';
  const confirm = {
    title: isDelete
      ? `Delete ${count} ${noun}?`
      : `${inArchivedView ? 'Unarchive' : 'Archive'} ${count} ${noun}?`,
    description: isDelete
      ? 'This permanently removes the selected reports. This cannot be undone.'
      : inArchivedView
        ? 'They will return to the active feed.'
        : 'They will be hidden from the active feed. You can unarchive them later.',
    confirmLabel: isDelete ? 'Delete' : inArchivedView ? 'Unarchive' : 'Archive',
    confirmVariant: isDelete ? ('destructive' as const) : ('secondary' as const),
  };

  return (
    <div className="sticky top-2 z-10 mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/95 px-3 py-2 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">
          {hasSelection ? `${count} selected` : 'Select reports'}
        </span>
        {!allSelected ? (
          <Button variant="ghost" size="sm" onClick={onSelectAll} disabled={busy}>
            <CheckSquare className="mr-1" /> Select all
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPending('toggle')}
          disabled={busy || !hasSelection}
        >
          {inArchivedView ? (
            <>
              <ArchiveRestore className="mr-1" /> Unarchive
            </>
          ) : (
            <>
              <Archive className="mr-1" /> Archive
            </>
          )}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setPending('delete')}
          disabled={busy || !hasSelection}
        >
          <Trash2 className="mr-1" /> Delete
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onExit}
          disabled={busy}
          aria-label="Exit selection"
        >
          <X />
        </Button>
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={confirm.title}
        description={confirm.description}
        confirmLabel={confirm.confirmLabel}
        confirmVariant={confirm.confirmVariant}
        onConfirm={async () => {
          try {
            await (isDelete ? runDelete() : runToggle());
          } catch {
            toast.error(`Failed to ${isDelete ? 'delete' : toggleVerb}`);
          }
        }}
      />
    </div>
  );
}
