import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronsUpDown, Menu, Plus } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { ProfileMenu } from '@/components/app-shell/profile-menu';
import { PulseLine } from '@/components/pulse-line';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useCurrentWorkspace } from '@/lib/workspace-context';
import { useSseConnected } from '@/hooks/use-live-updates';
import { useWorkspaces } from '@/hooks/use-workspace-data';

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const navigate = useNavigate();
  const { workspace } = useCurrentWorkspace();
  const workspaces = useWorkspaces();
  // The cadence pulse is a real liveness indicator: the comet travels only while
  // the SSE stream is connected; on the polling fallback it falls to a static line.
  const live = useSseConnected();

  const initial = workspace.name.charAt(0).toUpperCase();

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4 lg:px-10">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open navigation"
        onClick={onMenuClick}
      >
        <Menu className="size-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 px-2">
            <span className="flex size-5 items-center justify-center rounded bg-brand text-[0.6875rem] font-semibold text-brand-foreground">
              {initial}
            </span>
            <span className="hidden max-w-40 truncate font-medium sm:inline">{workspace.name}</span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.data?.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => navigate({ to: '/w/$ws', params: { ws: w.slug } })}
            >
              <span className="flex-1 truncate">{w.name}</span>
              {w.id === workspace.id ? <Check className="size-4 text-brand" /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate({ to: '/new-workspace' })}>
            <Plus className="size-4" /> New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div
        className={cn('ml-auto hidden items-center gap-2 md:flex')}
        title={live ? 'Live — receiving realtime updates' : 'Polling — realtime stream offline'}
      >
        <span
          className={cn(
            'text-[0.6875rem] uppercase tracking-wider transition-colors',
            live ? 'text-muted-foreground' : 'text-muted-foreground/50',
          )}
        >
          Cadence
        </span>
        <PulseLine width={180} height={28} beats={4} speed={4.5} live={live} />
      </div>

      <div className="ml-auto flex items-center gap-1 md:ml-4">
        <ThemeToggle />
        <ProfileMenu />
      </div>
    </header>
  );
}
