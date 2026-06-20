import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/lib/theme';
import { Toaster } from '@/components/ui/sonner';
import { queryClient } from '@/lib/query-client';
import { createAppRouter } from '@/router';

/**
 * App root: TanStack Query cache + theme + the type-safe TanStack Router.
 * The router carries the query client in its context so route guards can warm
 * data in `beforeLoad`. Toast surface lives under the theme provider.
 */
const router = createAppRouter(queryClient);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
