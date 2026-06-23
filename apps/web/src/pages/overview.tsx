import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight, Inbox, Radio } from 'lucide-react';
import { useCurrentWorkspace } from '@/lib/workspace-context';
import { useReportsInfinite } from '@/hooks/use-reports';
import { useSources } from '@/hooks/use-workspace-data';
import { ReportRow } from '@/components/report/report-row';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Mono } from '@/components/ui/mono';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, SkeletonRows } from '@/components/common/states';
import { Skeleton } from '@/components/ui/skeleton';
import { RelativeTime } from '@/components/common/relative-time';
import { SOURCE_STATUS, severityVariant, titleCase } from '@/lib/domain';
import { PageContainer, PageHeader } from '@/components/common/page';

/**
 * System Overview — the always-present landing (the grid dashboard builder is
 * Phase 9). Recent reports, an at-a-glance Alerts feed (warning/critical across
 * the whole workspace), and a connected-agents summary so the workspace is never
 * blank. The Alerts feed mirrors the alert_feed dashboard widget so the product's
 * core value is visible on first load without building a dashboard.
 */
export function OverviewPage() {
  const { workspace } = useCurrentWorkspace();
  const reports = useReportsInfinite({ wsId: workspace.id, filters: {} });
  const sources = useSources(workspace.id);

  const loaded = reports.data?.pages.flatMap((p) => p.reports) ?? [];
  const recent = loaded.slice(0, 6);
  const alerts = loaded
    .filter((r) => r.severity === 'warning' || r.severity === 'critical')
    .slice(0, 6);

  return (
    <PageContainer>
      <PageHeader title="Overview" description={`Welcome back to ${workspace.name}.`} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-10">
        <section className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">Recent reports</h2>
            <Link
              to="/w/$ws/reports"
              params={{ ws: workspace.slug }}
              className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
            >
              View all <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {reports.isPending ? (
            <SkeletonRows rows={4} />
          ) : reports.isError ? (
            <ErrorState error={reports.error} onRetry={() => reports.refetch()} />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No reports yet"
              description="Connect an agent on the Sources page to start receiving briefings."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {recent.map((report) => (
                <ReportRow key={report.id} ws={workspace.slug} report={report} />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-6">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
                <AlertTriangle className="size-4 text-severity-warning" /> Alerts
              </h2>
              <Link
                to="/w/$ws/reports"
                params={{ ws: workspace.slug }}
                search={{ severity: 'warning,critical' }}
                className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
              >
                View all <ArrowRight className="size-3.5" />
              </Link>
            </div>
            {reports.isPending ? (
              <SkeletonRows rows={3} />
            ) : reports.isError ? (
              <ErrorState error={reports.error} onRetry={() => reports.refetch()} />
            ) : alerts.length === 0 ? (
              <EmptyState
                icon={AlertTriangle}
                title="No active alerts"
                description="Warning and critical reports will surface here."
              />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {alerts.map((alert) => (
                  <li key={alert.id}>
                    <Link
                      to="/w/$ws/r/$reportId"
                      params={{ ws: workspace.slug, reportId: alert.id }}
                      className="group flex items-start gap-2.5 rounded-md border border-border bg-surface px-3 py-2 transition-colors hover:border-border-strong hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {alert.severity ? (
                        <Badge
                          variant={severityVariant(alert.severity)}
                          dot
                          className="mt-0.5 shrink-0"
                        >
                          {titleCase(alert.severity)}
                        </Badge>
                      ) : null}
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">
                          {alert.title}
                        </span>
                        <span className="text-[0.6875rem] text-muted-foreground">
                          {alert.stream.name} · <RelativeTime value={alert.occurredAt} />
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">Connected agents</h2>
              <Link
                to="/w/$ws/sources"
                params={{ ws: workspace.slug }}
                className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
              >
                Manage <ArrowRight className="size-3.5" />
              </Link>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Radio className="size-4 text-muted-foreground" /> Sources
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {sources.isPending ? (
                  <>
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </>
                ) : sources.isError ? (
                  <p className="text-xs text-muted-foreground">Couldn’t load sources.</p>
                ) : (sources.data?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No sources connected yet.</p>
                ) : (
                  sources.data!.map((s) => {
                    const meta = SOURCE_STATUS[s.status];
                    return (
                      <div key={s.id} className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium">{s.name}</span>
                          <span className="text-[0.6875rem] text-muted-foreground">
                            {s.lastSeenAt ? (
                              <RelativeTime value={s.lastSeenAt} />
                            ) : (
                              'never connected'
                            )}{' '}
                            · {s.reportCount} reports
                          </span>
                        </div>
                        <Badge variant={meta.variant} dot className="shrink-0">
                          {meta.label}
                        </Badge>
                      </div>
                    );
                  })
                )}
                {sources.data && sources.data.length > 0 ? (
                  <Mono className="mt-1 text-[0.625rem]">
                    schema v{sources.data[0].schemaVersion}
                  </Mono>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </PageContainer>
  );
}
