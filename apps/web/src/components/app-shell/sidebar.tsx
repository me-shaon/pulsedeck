import * as React from 'react';
import { LayoutGrid, Search, Radio, Settings, Hash, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LiveDot } from '@/components/live-dot';

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  id: string;
}

const NAV: NavItem[] = [
  { label: 'Overview', icon: LayoutGrid, id: 'overview' },
  { label: 'Search', icon: Search, id: 'search' },
  { label: 'Sources', icon: Radio, id: 'sources' },
  { label: 'Settings', icon: Settings, id: 'settings' },
];

// Placeholder auto category/stream tree (wired in a later phase).
const STREAMS: Array<{ name: string; status: 'healthy' | 'degraded' | 'down' }> = [
  { name: 'incidents', status: 'degraded' },
  { name: 'deploys', status: 'healthy' },
  { name: 'security', status: 'healthy' },
  { name: 'costs', status: 'down' },
];

export interface SidebarProps {
  active?: string;
  onNavigate?: (id: string) => void;
}

export function Sidebar({ active = 'overview', onNavigate }: SidebarProps) {
  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-60 flex-col border-r border-border bg-surface"
    >
      {/* Wordmark with a small live pulse dot. */}
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <LiveDot color="brand" size={9} />
        <span className="text-sm font-semibold tracking-tight">PulseDeck</span>
      </div>

      {/* Fixed items */}
      <div className="flex flex-col gap-0.5 p-2">
        {NAV.map((item) => {
          const isActive = item.id === active;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate?.(item.id)}
              aria-current={isActive ? 'page' : undefined}
              data-ring="self"
              className={cn(
                'group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive
                  ? 'bg-brand-tint font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {/* Brand indicator bar (the accent) instead of brand-colored text,
                  which keeps the label at AA contrast. */}
              <span
                aria-hidden
                className={cn(
                  'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brand transition-opacity',
                  isActive ? 'opacity-100' : 'opacity-0',
                )}
              />
              <Icon className="size-4 shrink-0" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Auto category / stream tree placeholder */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col px-2">
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
            Streams
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {STREAMS.map((s) => (
            <button
              key={s.name}
              type="button"
              data-ring="self"
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Hash className="size-3.5 shrink-0 opacity-60" />
              <span className="flex-1 text-left">{s.name}</span>
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full',
                  s.status === 'healthy' && 'bg-status-healthy',
                  s.status === 'degraded' && 'bg-status-degraded',
                  s.status === 'down' && 'bg-status-down',
                )}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border px-4 py-3 text-[0.6875rem] text-muted-foreground">
        <span className="mono">v0.1 · design system</span>
      </div>
    </nav>
  );
}
