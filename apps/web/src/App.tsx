import { useState } from 'react';
import { ThemeProvider } from '@/lib/theme';
import { AppShell } from '@/components/app-shell/app-shell';
import { Toaster } from '@/components/ui/sonner';
import { DesignPage } from '@/pages/design';

/**
 * For Phase 7 the app's default view is the design-system kitchen sink, shown
 * inside the real app shell. Product screens and routing arrive in Phase 8.
 */
export function App() {
  const [active, setActive] = useState('overview');
  return (
    <ThemeProvider>
      <AppShell active={active} onNavigate={setActive}>
        <DesignPage />
      </AppShell>
      <Toaster />
    </ThemeProvider>
  );
}
