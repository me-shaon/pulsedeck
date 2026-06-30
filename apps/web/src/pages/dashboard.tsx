import { useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { LayoutGrid, MoreHorizontal, Pencil, Plus, Save, Star, Trash2, X } from 'lucide-react';
import type { DashboardWidget, WidgetSpan, WidgetType } from '@/lib/api-types';
import { ApiError } from '@/lib/api';
import { useCurrentWorkspace, canBuildDashboards } from '@/lib/workspace-context';
import { useDashboard, useDashboardMutations } from '@/hooks/use-dashboards';
import { useEntityLookup } from '@/components/dashboard/use-entity-lookup';
import { DashboardGrid } from '@/components/dashboard/dashboard-grid';
import { WidgetConfigDialog } from '@/components/dashboard/widget-config-form';
import { RenameDashboardDialog } from '@/components/dashboard/dashboard-dialogs';
import { WIDGET_TYPES } from '@/components/dashboard/widget-types';
import { PageContainer, PageHeader } from '@/components/common/page';
import { ErrorState, errorMessage, SkeletonRows } from '@/components/common/states';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';

const route = getRouteApi('/w/$ws/d/$dashId');

interface ConfigState {
  open: boolean;
  type: WidgetType;
  widget?: DashboardWidget;
}

/** Stable display order for a saved layout: by `row`, then insertion. */
function sortWidgets(widgets: DashboardWidget[]): DashboardWidget[] {
  return widgets
    .map((w, i) => ({ w, i }))
    .sort((a, b) => a.w.row - b.w.row || a.i - b.i)
    .map(({ w }) => w);
}

/**
 * Dashboard view + builder (Phase 9). Renders the saved layout on the 12-column
 * grid; Editor+ can toggle edit mode to add/configure/remove/reorder widgets and
 * set spans, then persist the whole layout in one PATCH. Every widget isolates
 * its own loading/empty/error so a single failing widget never blanks the page.
 */
export function DashboardPage() {
  const { workspace, role } = useCurrentWorkspace();
  const wsId = workspace.id;
  const { dashId } = route.useParams();
  const navigate = route.useNavigate();
  const canBuild = canBuildDashboards(role);

  const q = useDashboard(wsId, dashId);
  const lookup = useEntityLookup(wsId);
  const { update, makeDefault, remove } = useDashboardMutations(wsId);

  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<DashboardWidget[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigState>({ open: false, type: 'metric' });
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (q.isPending) {
    return (
      <PageContainer>
        <PageHeader title="Dashboard" />
        <SkeletonRows rows={4} />
      </PageContainer>
    );
  }
  if (q.isError || !q.data) {
    return (
      <PageContainer>
        <PageHeader title="Dashboard" />
        <ErrorState error={q.error ?? new Error('Not found')} onRetry={() => q.refetch()} />
      </PageContainer>
    );
  }

  const dashboard = q.data;
  const savedWidgets = sortWidgets(dashboard.layout.widgets);
  const widgets = editMode ? draft : savedWidgets;

  // --- Edit-mode draft operations ---------------------------------------

  function enterEdit() {
    setDraft(sortWidgets(dashboard.layout.widgets));
    setSaveError(null);
    setEditMode(true);
  }
  function discard() {
    setEditMode(false);
    setDraft([]);
    setSaveError(null);
  }
  function upsertWidget(widget: DashboardWidget) {
    setDraft((prev) => {
      const idx = prev.findIndex((w) => w.id === widget.id);
      if (idx === -1) return [...prev, widget];
      const next = prev.slice();
      next[idx] = widget;
      return next;
    });
  }
  function removeWidget(id: string) {
    setDraft((prev) => prev.filter((w) => w.id !== id));
  }
  function moveWidget(id: string, direction: 'up' | 'down') {
    setDraft((prev) => {
      const idx = prev.findIndex((w) => w.id === id);
      if (idx === -1) return prev;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }
  function setSpan(id: string, span: WidgetSpan) {
    setDraft((prev) => prev.map((w) => (w.id === id ? { ...w, span } : w)));
  }

  async function save() {
    setSaveError(null);
    const layout = {
      version: 1 as const,
      // Renumber rows to the current draft order so the saved layout renders
      // back in exactly the order the builder shows.
      widgets: draft.map((w, i) => ({ ...w, row: i })),
    };
    try {
      await update.mutateAsync({ dashId, input: { layout } });
      toast('Dashboard saved');
      setEditMode(false);
      setDraft([]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setSaveError(errorMessage(e));
      } else if (e instanceof ApiError && e.status === 403) {
        setSaveError("You don't have permission to edit this dashboard.");
      } else {
        toast.error(errorMessage(e));
      }
    }
  }

  // --- Dashboard management ---------------------------------------------

  async function rename(input: { name: string; icon: string | null }) {
    await update.mutateAsync({ dashId, input });
    toast('Dashboard updated');
  }
  async function setAsDefault() {
    try {
      await makeDefault.mutateAsync(dashId);
      toast(`“${dashboard.name}” is now the default`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function destroy() {
    await remove.mutateAsync(dashId);
    toast('Dashboard deleted');
    navigate({ to: '/w/$ws', params: { ws: workspace.slug } });
  }

  function openAdd(type: WidgetType) {
    setConfig({ open: true, type, widget: undefined });
  }
  function openConfigure(id: string) {
    const widget = draft.find((w) => w.id === id);
    if (widget) setConfig({ open: true, type: widget.type, widget });
  }

  const actions = canBuild ? (
    editMode ? (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="size-4" /> Add widget
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {WIDGET_TYPES.map((t) => {
              const Icon = t.icon;
              return (
                <DropdownMenuItem key={t.type} onSelect={() => openAdd(t.type)}>
                  <Icon className="size-4 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-sm">{t.label}</span>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="sm" onClick={discard} disabled={update.isPending}>
          <X className="size-4" /> Discard
        </Button>
        <Button variant="primary" size="sm" onClick={save} disabled={update.isPending}>
          <Save className="size-4" /> {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </>
    ) : (
      <>
        <Button variant="outline" size="sm" onClick={enterEdit}>
          <Pencil className="size-4" /> Edit
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Dashboard menu">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onSelect={() => setRenameOpen(true)}
              className="whitespace-nowrap text-xs text-muted-foreground focus:text-foreground"
            >
              <Pencil className="size-3.5 shrink-0" /> Rename
            </DropdownMenuItem>
            {!dashboard.isDefault ? (
              <DropdownMenuItem
                onSelect={() => void setAsDefault()}
                className="whitespace-nowrap text-xs text-muted-foreground focus:text-foreground"
              >
                <Star className="size-3.5 shrink-0" /> Set as default
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setDeleteOpen(true)}
              className="whitespace-nowrap text-xs text-destructive/80 focus:text-destructive"
            >
              <Trash2 className="size-3.5 shrink-0" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    )
  ) : null;

  return (
    <PageContainer>
      <PageHeader
        title={dashboard.icon ? `${dashboard.icon} ${dashboard.name}` : dashboard.name}
        description={editMode ? 'Editing — add, configure, reorder, then save.' : undefined}
        actions={actions}
      />

      {dashboard.isDefault ? (
        <div className="mb-3 -mt-2">
          <Badge variant="brand" className="gap-1">
            <Star className="size-3" /> Default
          </Badge>
        </div>
      ) : null}

      {saveError ? (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {saveError}
        </div>
      ) : null}

      {widgets.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="This dashboard is empty"
          description={
            canBuild
              ? 'Add a widget to start building this page.'
              : 'No widgets yet. An editor can add some.'
          }
          action={
            canBuild ? (
              editMode ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="primary" size="sm">
                      <Plus className="size-4" /> Add your first widget
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="w-64">
                    {WIDGET_TYPES.map((t) => {
                      const Icon = t.icon;
                      return (
                        <DropdownMenuItem key={t.type} onSelect={() => openAdd(t.type)}>
                          <Icon className="size-4 text-muted-foreground" />
                          <span className="text-sm">{t.label}</span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button variant="primary" size="sm" onClick={enterEdit}>
                  <Pencil className="size-4" /> Edit dashboard
                </Button>
              )
            ) : undefined
          }
        />
      ) : (
        <DashboardGrid
          wsId={wsId}
          wsSlug={workspace.slug}
          widgets={widgets}
          lookup={lookup}
          editMode={editMode}
          onConfigure={openConfigure}
          onRemove={removeWidget}
          onMove={moveWidget}
          onSpanChange={setSpan}
        />
      )}

      <WidgetConfigDialog
        open={config.open}
        onOpenChange={(open) => setConfig((c) => ({ ...c, open }))}
        type={config.type}
        widget={config.widget}
        lookup={lookup}
        onSubmit={upsertWidget}
      />

      <RenameDashboardDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        dashboard={dashboard}
        onRename={rename}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${dashboard.name}”?`}
        description="This removes the dashboard and its layout. If it's the default, another dashboard is promoted."
        confirmLabel="Delete dashboard"
        onConfirm={destroy}
      />
    </PageContainer>
  );
}
