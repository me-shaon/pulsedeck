import { ChevronsUpDown, Menu, Plus } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
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

export interface TopbarProps {
  onMenuClick?: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4">
      {/* Mobile sidebar trigger */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open navigation"
        onClick={onMenuClick}
      >
        <Menu className="size-4" />
      </Button>

      {/* Workspace switcher placeholder */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 px-2">
            <span className="flex size-5 items-center justify-center rounded bg-brand text-[0.6875rem] font-semibold text-brand-foreground">
              P
            </span>
            <span className="hidden font-medium sm:inline">Personal</span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuItem>Personal</DropdownMenuItem>
          <DropdownMenuItem>Acme Platform</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <Plus className="size-4" /> New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The signature pulse line, living in the header. */}
      <div className="ml-auto hidden items-center gap-2 md:flex">
        <span className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
          Cadence
        </span>
        <PulseLine width={180} height={28} beats={4} speed={4.5} />
      </div>

      <div className="ml-auto md:ml-0">
        <ThemeToggle />
      </div>
    </header>
  );
}
