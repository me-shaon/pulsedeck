import { useState } from 'react';
import { Archive, ArchiveRestore, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ArchiveScope } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { useReportMutations } from '@/hooks/use-report-mutations';

/**
 * Floating toolbar shown while one or more reports are selected. Offers
 * archive/unarchive (the primary action flips by the current view's scope) and
 * hard-delete (behind a confirm dialog, since it is irreversible). Clears the
 * selection on success and surfaces the affected count via a toast.
 */
export function BulkActionBar({
  wsId,
  ids,
  scope,
  onClear,
}: {
  wsId: string;
  ids: string[];
  /** The list's current archive scope — decides archive vs. unarchive. */
  scope: ArchiveScope;
  onClear: () => void;
}) {
  const { archive, unarchive, remove } = useReportMutations(wsId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const count = ids.length;
  const noun = count === 1 ? 'report' : 'reports';
  const busy = archive.isPending || unarchive.isPending || remove.isPending;
  const inArchivedView = scope === 'archived';

  async function runArchiveToggle() {
    const mutation = inArchivedView ? unarchive : archive;
    const res = await mutation.mutateAsync(ids);
    toast.success(`${res.affected} ${noun} ${inArchivedView ? 'unarchived' : 'archived'}`);
    onClear();
  }

  async function runDelete() {
    const res = await remove.mutateAsync(ids);
    toast.success(`${res.affected} ${noun} deleted`);
    onClear();
  }

  return (
    <div className="sticky top-2 z-10 mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/95 px-3 py-2 shadow-lg backdrop-blur">
      <span className="text-xs font-medium text-foreground">{count} selected</span>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void runArchiveToggle().catch(() => toast.error('Action failed'))}
          disabled={busy}
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
          onClick={() => setConfirmDelete(true)}
          disabled={busy}
        >
          <Trash2 className="mr-1" /> Delete
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          disabled={busy}
          aria-label="Clear selection"
        >
          <X />
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${count} ${noun}?`}
        description="This permanently removes the selected reports. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await runDelete();
          } catch {
            toast.error('Delete failed');
          }
        }}
      />
    </div>
  );
}
