import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDashboard,
  deleteDashboard,
  getAlertFeed,
  getDashboard,
  getMetricLatest,
  getMetricSeries,
  getReportCount,
  listDashboards,
  listStreamReports,
  setDefaultDashboard,
  updateDashboard,
} from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { CountBucket, CountScope, DashboardLayout, WidgetRange } from '@/lib/api-types';
import { useLiveInterval } from './use-live-updates';

/**
 * Dashboard data + mutations (Phase 9). Reads poll on the live interval (the SSE
 * seam in `use-live-updates`); writes invalidate the affected dashboard keys so
 * the sidebar list + the open dashboard refetch. Every widget-data hook is keyed
 * on its full config so two widgets pointing at the same series share one query.
 */

// --- Dashboard list + detail --------------------------------------------

/** The workspace's dashboards (sidebar + landing resolution). */
export function useDashboards(wsId: string) {
  const refetchInterval = useLiveInterval();
  return useQuery({
    queryKey: queryKeys.dashboards(wsId),
    queryFn: ({ signal }) => listDashboards(wsId, signal),
    refetchInterval,
  });
}

/** One dashboard with its full, normalized layout. */
export function useDashboard(wsId: string, dashId: string) {
  const refetchInterval = useLiveInterval();
  return useQuery({
    queryKey: queryKeys.dashboard(wsId, dashId),
    queryFn: ({ signal }) => getDashboard(wsId, dashId, signal),
    select: (r) => r.dashboard,
    refetchInterval,
  });
}

// --- Dashboard CRUD mutations -------------------------------------------

/**
 * Create / update / set-default / delete a dashboard. Each settles by
 * invalidating the dashboards list (sidebar) and the touched dashboard so the UI
 * reflects the server's truth (e.g. the promoted default after a delete).
 */
export function useDashboardMutations(wsId: string) {
  const qc = useQueryClient();
  const invalidateList = () => qc.invalidateQueries({ queryKey: queryKeys.dashboards(wsId) });

  const create = useMutation({
    mutationFn: (input: { name: string; icon?: string | null; layout?: DashboardLayout }) =>
      createDashboard(wsId, input),
    onSuccess: () => invalidateList(),
  });

  const update = useMutation({
    mutationFn: (vars: {
      dashId: string;
      input: { name?: string; icon?: string | null; layout?: DashboardLayout; position?: number };
    }) => updateDashboard(wsId, vars.dashId, vars.input),
    onSuccess: (res) => {
      invalidateList();
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(wsId, res.dashboard.id) });
    },
  });

  const makeDefault = useMutation({
    mutationFn: (dashId: string) => setDefaultDashboard(wsId, dashId),
    onSuccess: () => invalidateList(),
  });

  const remove = useMutation({
    mutationFn: (dashId: string) => deleteDashboard(wsId, dashId),
    onSuccess: (_data, dashId) => {
      invalidateList();
      qc.removeQueries({ queryKey: queryKeys.dashboard(wsId, dashId) });
    },
  });

  return { create, update, makeDefault, remove };
}

// --- Per-widget data hooks ----------------------------------------------

/** metric widget — latest value (+ previous + delta) for a (stream, key). */
export function useMetricLatest(wsId: string, streamId: string, metricKey: string, enabled = true) {
  const refetchInterval = useLiveInterval();
  return useQuery({
    queryKey: queryKeys.metricLatest(wsId, streamId, metricKey),
    queryFn: ({ signal }) => getMetricLatest(wsId, streamId, metricKey, signal),
    enabled: enabled && Boolean(streamId) && Boolean(metricKey),
    refetchInterval,
  });
}

/** chart widget — a metric time-series within a range. */
export function useMetricSeries(
  wsId: string,
  streamId: string,
  metricKey: string,
  range: WidgetRange | undefined,
  enabled = true,
) {
  const refetchInterval = useLiveInterval();
  return useQuery({
    queryKey: queryKeys.metricSeries(wsId, streamId, metricKey, range ?? null),
    queryFn: ({ signal }) => getMetricSeries(wsId, streamId, metricKey, range, signal),
    enabled: enabled && Boolean(streamId) && Boolean(metricKey),
    refetchInterval,
  });
}

/** report_count widget — time-bucketed report volume for a stream/category. */
export function useReportCount(
  wsId: string,
  opts: { scope: CountScope; targetId: string; bucket?: CountBucket; range?: WidgetRange },
  enabled = true,
) {
  const refetchInterval = useLiveInterval();
  return useQuery({
    queryKey: queryKeys.reportCount(wsId, opts),
    queryFn: ({ signal }) => getReportCount(wsId, opts, signal),
    enabled: enabled && Boolean(opts.targetId),
    refetchInterval,
  });
}

/** alert_feed widget — recent warning|critical reports in a category. */
export function useAlertFeed(wsId: string, categoryId: string, limit: number, enabled = true) {
  const refetchInterval = useLiveInterval();
  return useQuery({
    queryKey: queryKeys.alertFeed(wsId, categoryId, limit),
    queryFn: ({ signal }) => getAlertFeed(wsId, categoryId, limit, signal),
    select: (r) => r.alerts,
    enabled: enabled && Boolean(categoryId),
    refetchInterval,
  });
}

/** stream_feed widget — latest N reports of a stream (reuses the Phase 6 list). */
export function useStreamFeed(wsId: string, streamId: string, limit: number, enabled = true) {
  const refetchInterval = useLiveInterval();
  return useQuery({
    queryKey: queryKeys.reports(wsId, { widget: 'stream_feed', streamId, limit }),
    queryFn: ({ signal }) => listStreamReports(wsId, streamId, {}, undefined, limit, signal),
    select: (r) => r.reports,
    enabled: enabled && Boolean(streamId),
    refetchInterval,
  });
}
