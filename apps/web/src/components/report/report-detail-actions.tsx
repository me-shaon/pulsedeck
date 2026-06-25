import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { useReportMutations } from '@/hooks/use-report-mutations';

type Pending = 'toggle' | 'delete' | null;

/**
 * Archive/unarchive + hard-delete for a single report, shown on the detail page
 * so the user can act without returning to the feed. Editor+ only (the API
 * enforces it too). Each action confirms first; on success it returns to the
 * report's stream, where the change is reflected.
 */
export function ReportDetailActions({
  wsId,
  wsSlug,
  reportId,
  streamId,
  archived,
}: {
  wsId: string;
  wsSlug: string;
  reportId: string;
  streamId: string;
  /** Whether this report is currently archived (flips Archive ↔ Unarchive). */
  archived: boolean;
}) {
  const navigate = useNavigate();
  const { archive, unarchive, remove } = useReportMutations(wsId);
  const [pending, setPending] = useState<Pending>(null);
  const busy = archive.isPending || unarchive.isPending || remove.isPending;
  const ids = [reportId];

  function goToStream() {
    void navigate({ to: '/w/$ws/stream/$streamId', params: { ws: wsSlug, streamId } });
  }

  async function runToggle() {
    await (archived ? unarchive : archive).mutateAsync(ids);
    toast.success(archived ? 'Report unarchived' : 'Report archived');
    goToStream();
  }
  async function runDelete() {
    await remove.mutateAsync(ids);
    toast.success('Report deleted');
    goToStream();
  }

  const isDelete = pending === 'delete';
  const confirm = {
    title: isDelete
      ? 'Delete this report?'
      : archived
        ? 'Unarchive this report?'
        : 'Archive this report?',
    description: isDelete
      ? 'This permanently removes the report. This cannot be undone.'
      : archived
        ? 'It will return to the active feed.'
        : 'It will be hidden from the active feed. You can unarchive it later.',
    confirmLabel: isDelete ? 'Delete' : archived ? 'Unarchive' : 'Archive',
    confirmVariant: isDelete ? ('destructive' as const) : ('secondary' as const),
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button variant="ghost" size="sm" onClick={() => setPending('toggle')} disabled={busy}>
        {archived ? (
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
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setPending('delete')}
        disabled={busy}
      >
        <Trash2 className="mr-1" /> Delete
      </Button>

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
            toast.error('Action failed');
          }
        }}
      />
    </div>
  );
}
