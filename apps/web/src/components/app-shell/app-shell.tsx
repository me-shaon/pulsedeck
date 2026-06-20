import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

/*
 * App shell: fixed left sidebar + top bar + main content frame. The Sidebar and
 * Topbar are self-wiring (router + workspace context + queries); the shell only
 * owns layout and the mobile slide-over. Responsive: at < lg the sidebar
 * collapses behind a slide-over opened from the topbar menu button.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden shrink-0 lg:block">
        <Sidebar />
      </aside>

      {/* Mobile slide-over (Radix Dialog → focus trap, Esc, scroll lock, a11y). */}
      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="animate-overlay-in fixed inset-0 z-50 bg-black/45 lg:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            className="animate-content-in fixed left-0 top-0 z-50 h-full focus:outline-none lg:hidden"
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
            <Dialog.Close
              aria-label="Close navigation"
              data-ring="self"
              className="absolute -right-10 top-3 rounded-md p-1.5 text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-5" />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
