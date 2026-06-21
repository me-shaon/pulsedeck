import { useNavigate } from '@tanstack/react-router';
import { LogOut, UserCog } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut, useSession } from '@/lib/auth-client';
import { invalidateAuth } from '@/lib/guards';
import { queryClient } from '@/lib/query-client';
import { useCurrentWorkspace } from '@/lib/workspace-context';

/**
 * User identity menu (top-right). Account-scoped actions live here — profile and
 * sign out — kept separate from the workspace switcher, which only switches or
 * creates workspaces.
 */
export function ProfileMenu() {
  const navigate = useNavigate();
  const { workspace } = useCurrentWorkspace();
  const { data } = useSession();
  const user = data?.user;

  const label = user?.name?.trim() || user?.email || 'Account';
  const initial = (user?.name?.trim() || user?.email || '?').charAt(0).toUpperCase();

  async function handleSignOut() {
    await signOut();
    await invalidateAuth(queryClient);
    // Drop ALL cached data so the next user on this browser can't read the
    // previous user's workspace data from the in-memory cache.
    queryClient.clear();
    toast('Signed out');
    navigate({ to: '/login' });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account menu">
          <span className="flex size-6 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-foreground">
            {initial}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{label}</span>
          {user?.email ? (
            <span className="truncate text-[0.6875rem] font-normal text-muted-foreground">
              {user.email}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => navigate({ to: '/w/$ws/account', params: { ws: workspace.slug } })}
        >
          <UserCog className="size-4" /> Account settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
