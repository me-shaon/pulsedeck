import * as React from 'react';
import { X } from 'lucide-react';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

/*
 * App shell: fixed left sidebar + top bar + main content frame.
 * Presentational only (no data wiring). Responsive: at < lg the sidebar
 * collapses behind a slide-over opened from the topbar menu button.
 */
export interface AppShellProps {
  children: React.ReactNode;
  active?: string;
  onNavigate?: (id: string) => void;
}

export function AppShell({ children, active, onNavigate }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden shrink-0 lg:block">
        <Sidebar active={active} onNavigate={onNavigate} />
      </aside>

      {/* Mobile slide-over sidebar */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/45 animate-overlay-in"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full animate-content-in">
            <Sidebar
              active={active}
              onNavigate={(id) => {
                onNavigate?.(id);
                setMobileOpen(false);
              }}
            />
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
              data-ring="self"
              className="absolute -right-10 top-3 rounded-md p-1.5 text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
