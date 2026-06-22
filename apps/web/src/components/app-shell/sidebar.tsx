import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  GripVertical,
  Hash,
  LayoutDashboard,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  Radio,
  Search,
  Settings,
  Sparkles,
  Star,
  Terminal,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/brand/logo';
import {
  canBuildDashboards,
  canManage,
  canManageStructure,
  useCurrentWorkspace,
} from '@/lib/workspace-context';
import { useStructureMutations, useTree } from '@/hooks/use-workspace-data';
import { useDashboards, useDashboardMutations } from '@/hooks/use-dashboards';
import { CreateDashboardDialog } from '@/components/dashboard/dashboard-dialogs';
import { StructureDialog } from '@/components/structure/structure-dialogs';
import { AgentInstructionsDialog } from '@/components/structure/agent-instructions-dialog';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { errorMessage } from '@/components/common/states';
import { queryKeys } from '@/lib/query-client';
import type { Tree, TreeCategory, TreeStream } from '@/lib/api-types';

/**
 * Wired sidebar: the workspace's dashboards as pages (Overview fallback + each
 * custom dashboard, the default marked with a star), the fixed system items
 * (All reports, Search, Sources, Settings), and the category → stream tree from
 * `GET /tree`. Editors+ get inline management (create/rename/delete/reorder) and
 * owners/admins can copy destination-scoped agent instructions. Active state is
 * router-derived.
 */

// TanStack Router's Link className is a string; active/inactive styling goes
// through activeProps/inactiveProps (which it merges onto className).
const navBase =
  'group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const linkActive = { className: 'bg-brand-tint font-medium text-foreground' };
const linkInactive = { className: 'text-muted-foreground hover:bg-accent hover:text-foreground' };
const streamBase =
  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const NAV = [
  { label: 'All reports', icon: Hash, to: '/w/$ws/reports' as const },
  { label: 'Search', icon: Search, to: '/w/$ws/search' as const },
  { label: 'Sources', icon: Radio, to: '/w/$ws/sources' as const },
  { label: 'Settings', icon: Settings, to: '/w/$ws/settings' as const },
];

type CategoryDialogState = { mode: 'create' } | { mode: 'rename'; category: TreeCategory } | null;
type StreamDialogState =
  | { mode: 'create'; categoryId: string }
  | { mode: 'rename'; stream: TreeStream }
  | null;
type DeleteState =
  | { kind: 'category'; category: TreeCategory }
  | { kind: 'stream'; stream: TreeStream }
  | null;
type InstrTarget = { kind: 'category' | 'stream'; id: string; name: string } | null;

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { workspace, role } = useCurrentWorkspace();
  const ws = workspace.slug;
  const navigate = useNavigate();
  const tree = useTree(workspace.id);
  const dashboards = useDashboards(workspace.id);
  const { create } = useDashboardMutations(workspace.id);
  const structure = useStructureMutations(workspace.id);
  const qc = useQueryClient();
  const canBuild = canBuildDashboards(role);
  const canStructure = canManageStructure(role);
  const canCopyInstructions = canManage(role);
  const [createOpen, setCreateOpen] = useState(false);

  // Structure management dialog state.
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialogState>(null);
  const [streamDialog, setStreamDialog] = useState<StreamDialogState>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteState>(null);
  const [instrTarget, setInstrTarget] = useState<InstrTarget>(null);

  async function handleCreate(input: { name: string; icon: string | null }) {
    const { dashboard } = await create.mutateAsync(input);
    toast(`Created “${dashboard.name}”`);
    onNavigate?.();
    navigate({ to: '/w/$ws/d/$dashId', params: { ws, dashId: dashboard.id } });
  }

  /** Optimistically reorder a list in the tree cache before the mutation lands. */
  function optimisticReorder(updater: (t: Tree) => Tree) {
    qc.setQueryData<Tree>(queryKeys.tree(workspace.id), (prev) => (prev ? updater(prev) : prev));
  }

  function reorderCategories(orderedIds: string[]) {
    optimisticReorder((t) => ({
      ...t,
      categories: [...t.categories].sort(
        (a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id),
      ),
    }));
    structure.reorderCategories.mutateAsync(orderedIds).catch((e) => toast.error(errorMessage(e)));
  }

  function reorderStreams(categoryId: string, orderedIds: string[]) {
    optimisticReorder((t) => ({
      ...t,
      categories: t.categories.map((c) =>
        c.id === categoryId
          ? {
              ...c,
              streams: [...c.streams].sort(
                (a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id),
              ),
            }
          : c,
      ),
    }));
    structure.reorderStreams
      .mutateAsync({ categoryId, ids: orderedIds })
      .catch((e) => toast.error(errorMessage(e)));
  }

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-60 flex-col border-r border-border bg-surface"
    >
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Logo />
      </div>

      {/* Dashboards (pages) */}
      <div className="flex flex-col gap-0.5 p-2">
        <div className="flex items-center justify-between px-2.5 py-1">
          <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
            Dashboards
          </span>
          {canBuild ? (
            <button
              type="button"
              data-ring="self"
              aria-label="New dashboard"
              title="New dashboard"
              onClick={() => setCreateOpen(true)}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3.5" />
            </button>
          ) : null}
        </div>

        <Link
          to="/w/$ws/overview"
          params={{ ws }}
          onClick={onNavigate}
          data-ring="self"
          className={navBase}
          activeProps={linkActive}
          inactiveProps={linkInactive}
        >
          {({ isActive }) => (
            <>
              <Indicator active={isActive} />
              <LayoutGrid className="size-4 shrink-0" />
              Overview
            </>
          )}
        </Link>

        {dashboards.isPending ? (
          <div className="flex flex-col gap-1.5 px-2.5 py-1">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ) : (
          dashboards.data?.dashboards.map((d) => (
            <Link
              key={d.id}
              to="/w/$ws/d/$dashId"
              params={{ ws, dashId: d.id }}
              onClick={onNavigate}
              data-ring="self"
              className={navBase}
              activeProps={linkActive}
              inactiveProps={linkInactive}
              title={d.name}
            >
              {({ isActive }) => (
                <>
                  <Indicator active={isActive} />
                  {d.icon ? (
                    <span className="flex size-4 shrink-0 items-center justify-center text-sm leading-none">
                      {d.icon}
                    </span>
                  ) : (
                    <LayoutDashboard className="size-4 shrink-0" />
                  )}
                  <span className="flex-1 truncate text-left">{d.name}</span>
                  {d.isDefault ? (
                    <Star
                      className="size-3 shrink-0 text-muted-foreground"
                      aria-label="Default dashboard"
                    />
                  ) : null}
                </>
              )}
            </Link>
          ))
        )}
      </div>

      <div className="flex flex-col gap-0.5 border-t border-border px-2 py-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              to={item.to}
              params={{ ws }}
              onClick={onNavigate}
              data-ring="self"
              className={navBase}
              activeProps={linkActive}
              inactiveProps={linkInactive}
            >
              {({ isActive }) => (
                <>
                  <Indicator active={isActive} />
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-2 flex min-h-0 flex-1 flex-col px-2">
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
            Streams
          </span>
          {canStructure ? (
            <button
              type="button"
              data-ring="self"
              aria-label="New category"
              title="New category"
              onClick={() => setCategoryDialog({ mode: 'create' })}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto pb-2">
          {tree.isPending ? (
            <div className="flex flex-col gap-1.5 px-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : tree.isError ? (
            <p className="px-2.5 text-xs text-muted-foreground">Couldn’t load streams.</p>
          ) : tree.data.categories.length === 0 ? (
            <div className="flex flex-col gap-2 px-2.5">
              <p className="text-xs text-muted-foreground">
                {canStructure
                  ? 'No categories yet — create one, or let an agent push reports.'
                  : 'No streams yet — they appear as agents push reports.'}
              </p>
              {canStructure ? (
                <button
                  type="button"
                  onClick={() => setCategoryDialog({ mode: 'create' })}
                  className="flex items-center gap-1.5 self-start rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3.5" /> Create category
                </button>
              ) : null}
            </div>
          ) : (
            tree.data.categories.map((category) => (
              <CategoryGroup
                key={category.id}
                ws={ws}
                category={category}
                allCategoryIds={tree.data.categories.map((c) => c.id)}
                canStructure={canStructure}
                canCopyInstructions={canCopyInstructions}
                onNavigate={onNavigate}
                onAddStream={() => setStreamDialog({ mode: 'create', categoryId: category.id })}
                onRename={() => setCategoryDialog({ mode: 'rename', category })}
                onDelete={() => setDeleteTarget({ kind: 'category', category })}
                onCopyInstructions={() =>
                  setInstrTarget({ kind: 'category', id: category.id, name: category.name })
                }
                onRenameStream={(stream) => setStreamDialog({ mode: 'rename', stream })}
                onDeleteStream={(stream) => setDeleteTarget({ kind: 'stream', stream })}
                onCopyStreamInstructions={(stream) =>
                  setInstrTarget({ kind: 'stream', id: stream.id, name: stream.name })
                }
                onReorderCategories={reorderCategories}
                onReorderStreams={reorderStreams}
              />
            ))
          )}
        </div>
      </div>

      <div className="border-t border-border px-4 py-3 text-[0.6875rem] text-muted-foreground">
        <span className="truncate">{workspace.name}</span>
      </div>

      <CreateDashboardDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
      />

      {/* Category create / rename */}
      <StructureDialog
        open={categoryDialog !== null}
        onOpenChange={(o) => (!o ? setCategoryDialog(null) : undefined)}
        kind="category"
        mode={categoryDialog?.mode ?? 'create'}
        initialName={categoryDialog?.mode === 'rename' ? categoryDialog.category.name : ''}
        onSubmit={async (name) => {
          if (categoryDialog?.mode === 'rename') {
            await structure.renameCategory.mutateAsync({ id: categoryDialog.category.id, name });
            toast(`Renamed to “${name}”`);
          } else {
            await structure.createCategory.mutateAsync({ name });
            toast(`Created “${name}”`);
          }
        }}
      />

      {/* Stream create / rename */}
      <StructureDialog
        open={streamDialog !== null}
        onOpenChange={(o) => (!o ? setStreamDialog(null) : undefined)}
        kind="stream"
        mode={streamDialog?.mode ?? 'create'}
        initialName={streamDialog?.mode === 'rename' ? streamDialog.stream.name : ''}
        onSubmit={async (name) => {
          if (streamDialog?.mode === 'rename') {
            await structure.renameStream.mutateAsync({ id: streamDialog.stream.id, name });
            toast(`Renamed to “${name}”`);
          } else if (streamDialog?.mode === 'create') {
            await structure.createStream.mutateAsync({ categoryId: streamDialog.categoryId, name });
            toast(`Created “${name}”`);
          }
        }}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => (!o ? setDeleteTarget(null) : undefined)}
        title={
          deleteTarget?.kind === 'category'
            ? `Delete “${deleteTarget.category.name}”?`
            : `Delete “${deleteTarget?.stream.name ?? ''}”?`
        }
        description={
          deleteTarget?.kind === 'category'
            ? `Deletes this category, its ${deleteTarget.category.streams.length} stream(s), and all their reports. This cannot be undone.`
            : `Deletes this stream and its ${deleteTarget?.stream.reportCount ?? 0} report(s). This cannot be undone.`
        }
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteTarget?.kind === 'category') {
            await structure.deleteCategory.mutateAsync(deleteTarget.category.id);
            toast('Category deleted');
          } else if (deleteTarget?.kind === 'stream') {
            await structure.deleteStream.mutateAsync(deleteTarget.stream.id);
            toast('Stream deleted');
          }
        }}
      />

      {/* Agent instructions */}
      <AgentInstructionsDialog
        open={instrTarget !== null}
        onOpenChange={(o) => (!o ? setInstrTarget(null) : undefined)}
        wsId={workspace.id}
        wsSlug={ws}
        target={instrTarget}
      />
    </nav>
  );
}

function CategoryGroup({
  ws,
  category,
  allCategoryIds,
  canStructure,
  canCopyInstructions,
  onNavigate,
  onAddStream,
  onRename,
  onDelete,
  onCopyInstructions,
  onRenameStream,
  onDeleteStream,
  onCopyStreamInstructions,
  onReorderCategories,
  onReorderStreams,
}: {
  ws: string;
  category: TreeCategory;
  allCategoryIds: string[];
  canStructure: boolean;
  canCopyInstructions: boolean;
  onNavigate?: () => void;
  onAddStream: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyInstructions: () => void;
  onRenameStream: (stream: TreeStream) => void;
  onDeleteStream: (stream: TreeStream) => void;
  onCopyStreamInstructions: (stream: TreeStream) => void;
  onReorderCategories: (orderedIds: string[]) => void;
  onReorderStreams: (categoryId: string, orderedIds: string[]) => void;
}) {
  function handleCategoryDrop(draggedId: string) {
    if (draggedId === category.id) return;
    const ids = allCategoryIds.filter((id) => id !== draggedId);
    const at = ids.indexOf(category.id);
    ids.splice(at, 0, draggedId);
    onReorderCategories(ids);
  }

  return (
    <div
      className="flex flex-col gap-0.5"
      draggable={canStructure}
      onDragStart={(e) => {
        if (!canStructure) return;
        e.dataTransfer.setData('application/x-pd-category', category.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (canStructure && e.dataTransfer.types.includes('application/x-pd-category')) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('application/x-pd-category');
        if (id) {
          e.preventDefault();
          handleCategoryDrop(id);
        }
      }}
    >
      <div className="group/cat flex items-center gap-1 px-2.5 py-1">
        {canStructure ? (
          <GripVertical
            className="size-3 shrink-0 cursor-grab text-muted-foreground/40 opacity-0 transition-opacity group-hover/cat:opacity-100"
            aria-hidden
          />
        ) : null}
        <span className="flex-1 truncate text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground/80">
          {category.name}
        </span>
        {category.labelSource === 'auto' ? (
          <Sparkles
            className="size-3 shrink-0 text-muted-foreground/40"
            aria-label="Auto-named — rename to customize"
          />
        ) : null}
        {canStructure ? (
          <>
            <button
              type="button"
              aria-label={`Add stream to ${category.name}`}
              title="Add stream"
              onClick={onAddStream}
              className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/cat:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3.5" />
            </button>
            <RowMenu
              label={`${category.name} options`}
              canCopyInstructions={canCopyInstructions}
              onCopyInstructions={onCopyInstructions}
              onRename={onRename}
              onDelete={onDelete}
            />
          </>
        ) : null}
      </div>

      {category.streams.map((stream) => (
        <div
          key={stream.id}
          className="group/stream flex items-center"
          draggable={canStructure}
          onDragStart={(e) => {
            if (!canStructure) return;
            e.stopPropagation();
            e.dataTransfer.setData('application/x-pd-stream', stream.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (canStructure && e.dataTransfer.types.includes('application/x-pd-stream')) {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            const draggedId = e.dataTransfer.getData('application/x-pd-stream');
            if (!draggedId || draggedId === stream.id) return;
            e.preventDefault();
            e.stopPropagation();
            const streamIds = category.streams.map((s) => s.id);
            if (!streamIds.includes(draggedId)) return;
            const ids = streamIds.filter((id) => id !== draggedId);
            const at = ids.indexOf(stream.id);
            ids.splice(at, 0, draggedId);
            onReorderStreams(category.id, ids);
          }}
        >
          <Link
            to="/w/$ws/stream/$streamId"
            params={{ ws, streamId: stream.id }}
            onClick={onNavigate}
            data-ring="self"
            className={cn(streamBase, 'min-w-0 flex-1')}
            activeProps={linkActive}
            inactiveProps={linkInactive}
            title={`${category.name} / ${stream.name}`}
          >
            <Hash className="size-3.5 shrink-0 opacity-60" />
            <span className="flex-1 truncate text-left">{stream.name}</span>
            {stream.labelSource === 'auto' ? (
              <Sparkles
                className="size-3 shrink-0 text-muted-foreground/40"
                aria-label="Auto-named — rename to customize"
              />
            ) : null}
            <span className="tabular-nums text-[0.6875rem] text-muted-foreground">
              {stream.reportCount}
            </span>
          </Link>
          {canStructure ? (
            <RowMenu
              label={`${stream.name} options`}
              canCopyInstructions={canCopyInstructions}
              onCopyInstructions={() => onCopyStreamInstructions(stream)}
              onRename={() => onRenameStream(stream)}
              onDelete={() => onDeleteStream(stream)}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RowMenu({
  label,
  canCopyInstructions,
  onCopyInstructions,
  onRename,
  onDelete,
}: {
  label: string;
  canCopyInstructions: boolean;
  onCopyInstructions: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/cat:opacity-100 group-hover/stream:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={onRename}>
          <Pencil className="size-3.5" /> Rename
        </DropdownMenuItem>
        {canCopyInstructions ? (
          <DropdownMenuItem onSelect={onCopyInstructions}>
            <Terminal className="size-3.5" /> Copy agent instructions
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="size-3.5" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Indicator({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brand transition-opacity',
        active ? 'opacity-100' : 'opacity-0',
      )}
    />
  );
}
