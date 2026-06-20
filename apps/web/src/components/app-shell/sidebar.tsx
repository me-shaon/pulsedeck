import { Link } from '@tanstack/react-router';
import { Hash, LayoutGrid, Radio, Search, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LiveDot } from '@/components/live-dot';
import { useCurrentWorkspace } from '@/lib/workspace-context';
import { useTree } from '@/hooks/use-workspace-data';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Wired sidebar: fixed system items (Overview, Search, Sources, Settings) +
 * the auto-generated category → stream tree from `GET /tree`. Each stream links
 * to its feed and shows its report count. Active state is router-derived.
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
  { label: 'Overview', icon: LayoutGrid, to: '/w/$ws' as const, exact: true },
  { label: 'All reports', icon: Hash, to: '/w/$ws/reports' as const, exact: false },
  { label: 'Search', icon: Search, to: '/w/$ws/search' as const, exact: false },
  { label: 'Sources', icon: Radio, to: '/w/$ws/sources' as const, exact: false },
  { label: 'Settings', icon: Settings, to: '/w/$ws/settings' as const, exact: false },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { workspace } = useCurrentWorkspace();
  const ws = workspace.slug;
  const tree = useTree(workspace.id);

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-60 flex-col border-r border-border bg-surface"
    >
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <LiveDot color="brand" size={9} />
        <span className="text-sm font-semibold tracking-tight">PulseDeck</span>
      </div>

      <div className="flex flex-col gap-0.5 p-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              to={item.to}
              params={{ ws }}
              activeOptions={{ exact: item.exact }}
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
            <p className="px-2.5 text-xs text-muted-foreground">
              No streams yet — they appear as agents push reports.
            </p>
          ) : (
            tree.data.categories.map((category) => (
              <div key={category.id} className="flex flex-col gap-0.5">
                <span className="px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground/80">
                  {category.name}
                </span>
                {category.streams.map((stream) => (
                  <Link
                    key={stream.id}
                    to="/w/$ws/stream/$streamId"
                    params={{ ws, streamId: stream.id }}
                    onClick={onNavigate}
                    data-ring="self"
                    className={streamBase}
                    activeProps={linkActive}
                    inactiveProps={linkInactive}
                    title={`${category.name} / ${stream.name}`}
                  >
                    <Hash className="size-3.5 shrink-0 opacity-60" />
                    <span className="flex-1 truncate text-left">{stream.name}</span>
                    <span className="tabular-nums text-[0.6875rem] text-muted-foreground">
                      {stream.reportCount}
                    </span>
                  </Link>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="border-t border-border px-4 py-3 text-[0.6875rem] text-muted-foreground">
        <span className="truncate">{workspace.name}</span>
      </div>
    </nav>
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
