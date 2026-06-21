import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { ensureAuthConfig, ensureDashboards, ensureSession, ensureWorkspaces } from '@/lib/guards';
import { validateReportSearch } from '@/lib/report-search';
import { WorkspaceProvider } from '@/lib/workspace-context';
import { useWorkspaceLiveUpdates } from '@/hooks/use-live-updates';
import { AppShell } from '@/components/app-shell/app-shell';
import { ErrorState } from '@/components/common/states';
import { PulseLine } from '@/components/pulse-line';
import { LoginPage } from '@/pages/login';
import { SetupPage } from '@/pages/setup';
import { InvitePage } from '@/pages/invite';
import { NewWorkspacePage } from '@/pages/new-workspace';
import { OverviewPage } from '@/pages/overview';
import { DashboardPage } from '@/pages/dashboard';
import { ReportsPage } from '@/pages/reports';
import { StreamPage } from '@/pages/stream';
import { ReportDetailPage } from '@/pages/report-detail';
import { SearchPage } from '@/pages/search';
import { SourcesPage } from '@/pages/sources';
import { SettingsPage } from '@/pages/settings';
import { AccountPage } from '@/pages/account';
import type { Role, Workspace } from '@/lib/api-types';

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
});

// --- Unauthenticated screens --------------------------------------------

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => {
    // Only accept a same-origin relative path (single leading slash). Rejects
    // `//host`, `https://…`, and other absolute targets → no open redirect.
    const r = typeof s.redirect === 'string' ? s.redirect : undefined;
    return { redirect: r && /^\/(?!\/)/.test(r) ? r : undefined };
  },
  beforeLoad: async ({ context, search }) => {
    const config = await ensureAuthConfig(context.queryClient);
    if (config.setupRequired) throw redirect({ to: '/setup' });
    const user = await ensureSession(context.queryClient);
    if (user) throw redirect({ to: search.redirect ?? '/' });
  },
  component: LoginPage,
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  beforeLoad: async ({ context }) => {
    const config = await ensureAuthConfig(context.queryClient);
    if (!config.setupRequired) throw redirect({ to: '/' });
  },
  component: SetupPage,
});

/** Require a session; bounce to /login (preserving where we came from). */
async function requireSession(context: RouterContext, pathname: string) {
  const config = await ensureAuthConfig(context.queryClient);
  if (config.setupRequired) throw redirect({ to: '/setup' });
  const user = await ensureSession(context.queryClient);
  if (!user) throw redirect({ to: '/login', search: { redirect: pathname } });
  return user;
}

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite',
  validateSearch: (s: Record<string, unknown>): { token?: string } => ({
    token: typeof s.token === 'string' ? s.token : undefined,
  }),
  beforeLoad: async ({ context, location }) => {
    await requireSession(context, location.pathname);
  },
  component: InvitePage,
});

const newWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/new-workspace',
  beforeLoad: async ({ context, location }) => {
    await requireSession(context, location.pathname);
  },
  component: NewWorkspacePage,
});

// --- Index: route the user to the right place ----------------------------

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async ({ context, location }) => {
    await requireSession(context, location.pathname);
    const workspaces = await ensureWorkspaces(context.queryClient);
    if (workspaces.length === 0) throw redirect({ to: '/new-workspace' });
    throw redirect({ to: '/w/$ws', params: { ws: workspaces[0].slug } });
  },
  component: () => null,
});

// --- Workspace shell + nested screens ------------------------------------

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$ws',
  beforeLoad: async ({ context, location, params }) => {
    await requireSession(context, location.pathname);
    const workspaces = await ensureWorkspaces(context.queryClient);
    if (workspaces.length === 0) throw redirect({ to: '/new-workspace' });
    const match = workspaces.find((w) => w.slug === params.ws);
    if (!match) throw redirect({ to: '/w/$ws', params: { ws: workspaces[0].slug } });
    const workspace: Workspace = { id: match.id, name: match.name, slug: match.slug };
    return { workspace, role: match.role as Role };
  },
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  const { workspace, role } = workspaceRoute.useRouteContext();
  // One SSE subscription per open workspace; re-subscribes on workspace switch.
  useWorkspaceLiveUpdates(workspace.id);
  return (
    <WorkspaceProvider workspace={workspace} role={role}>
      <AppShell>
        <Outlet />
      </AppShell>
    </WorkspaceProvider>
  );
}

/**
 * Workspace landing (`/w/$ws`): resolve to the default dashboard when one
 * exists, else render the system Overview (recent reports + connected agents) so
 * the landing page is never blank (PRD: auto Overview fallback).
 */
const overviewRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/',
  beforeLoad: async ({ context }) => {
    const { workspace, queryClient } = context;
    const res = await ensureDashboards(queryClient, workspace.id);
    if (res.defaultDashboardId) {
      throw redirect({
        to: '/w/$ws/d/$dashId',
        params: { ws: workspace.slug, dashId: res.defaultDashboardId },
      });
    }
  },
  component: OverviewPage,
});

/** Always-reachable system Overview (the sidebar's "Overview" link target). */
const explicitOverviewRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'overview',
  component: OverviewPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'd/$dashId',
  component: DashboardPage,
});

const reportsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'reports',
  validateSearch: validateReportSearch,
  component: ReportsPage,
});

const searchRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'search',
  validateSearch: validateReportSearch,
  component: SearchPage,
});

const streamRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'stream/$streamId',
  validateSearch: validateReportSearch,
  component: StreamPage,
});

const reportDetailRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'r/$reportId',
  component: ReportDetailPage,
});

const sourcesRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'sources',
  component: SourcesPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'settings',
  component: SettingsPage,
});

const accountRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'account',
  component: AccountPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  setupRoute,
  inviteRoute,
  newWorkspaceRoute,
  indexRoute,
  workspaceRoute.addChildren([
    overviewRoute,
    explicitOverviewRoute,
    dashboardRoute,
    reportsRoute,
    searchRoute,
    streamRoute,
    reportDetailRoute,
    sourcesRoute,
    settingsRoute,
    accountRoute,
  ]),
]);

function RouterError({ error }: { error: Error }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <ErrorState error={error} onRetry={() => window.location.reload()} />
      </div>
    </div>
  );
}

function RouterNotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm font-semibold text-foreground">Page not found</p>
        <a href="/" className="text-sm text-brand hover:underline">
          Back to PulseDeck
        </a>
      </div>
    </div>
  );
}

function RouterPending() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <PulseLine width={200} height={32} beats={4} speed={3.5} />
    </div>
  );
}

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultPendingComponent: RouterPending,
    defaultErrorComponent: RouterError,
    defaultNotFoundComponent: RouterNotFound,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
