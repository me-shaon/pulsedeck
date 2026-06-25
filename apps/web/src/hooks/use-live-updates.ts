import { useEffect, useSyncExternalStore } from 'react';
import { POLL_INTERVAL_MS, queryClient, queryKeys } from '@/lib/query-client';

/**
 * Realtime live updates (Phase 10).
 *
 * PulseDeck stays fresh by polling — every list/detail/widget query refetches on
 * `useLiveInterval()` (and on window focus). This module layers an SSE
 * subscription ON TOP so updates are near-instant, while polling stays as a
 * safety-net fallback that NEVER fully stops.
 *
 *   - `useWorkspaceLiveUpdates(workspaceId)` is mounted ONCE per workspace (in
 *     the AppShell / WorkspaceLayout). It opens an `EventSource` to the
 *     same-origin, cookie-authenticated events endpoint and, on each `report`
 *     push, invalidates the minimal set of affected query keys so the UI
 *     refetches just what changed.
 *   - `useLiveInterval()` returns the polling interval. While SSE is connected it
 *     backs off to a longer safety-net interval; otherwise it returns the normal
 *     `POLL_INTERVAL_MS`. Call sites pass it straight to `refetchInterval`.
 *
 * Graceful degradation: if SSE is disabled server-side (503), unsupported, or the
 * connection drops, we simply mark "not connected" and polling carries the app.
 * Never throws, never blocks rendering, never surfaces errors to the user.
 */

/** Safety-net poll interval used while SSE is actively delivering pushes. */
const SSE_FALLBACK_INTERVAL_MS = 60_000;

/**
 * Compact `report` event payload (no blocks — reports are immutable, so a detail
 * never changes; a new report only needs the lists/widgets refreshed).
 */
interface ReportEventPayload {
  reportId: string;
  streamId: string;
  categoryId: string;
  severity: string;
  occurredAt: string;
  receivedAt: string;
  title: string;
}

/**
 * Compact lifecycle event payload (archive/unarchive/delete). Id-only — the
 * client just refreshes the affected stream's lists and the tree counts.
 */
interface ReportLifecyclePayload {
  kind: 'archived' | 'unarchived' | 'deleted';
  streamId: string;
  reportIds: string[];
}

// --- "SSE connected" signal -------------------------------------------------
// A tiny module-level store read via useSyncExternalStore, so `useLiveInterval`
// can observe connection state without prop drilling. Only one workspace is
// mounted at a time, so a single global flag is sufficient.

let sseConnected = false;
const listeners = new Set<() => void>();

function setConnected(value: boolean): void {
  if (sseConnected === value) return;
  sseConnected = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return sseConnected;
}

/** Reactively reports whether the SSE stream is currently connected. */
export function useSseConnected(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

// --- Invalidation -----------------------------------------------------------

/**
 * Invalidate the minimal set of query keys affected by a new report. All keys
 * are workspace-scoped, so another workspace's cache is never touched.
 */
function invalidateForReport(wsId: string, payload: ReportEventPayload): void {
  // The report list family: All Reports, Search, and per-stream feeds.
  // queryKeys.reports(wsId, scope) -> ['reports', wsId, scope]; invalidate by
  // the ['reports', wsId] prefix to cover every scope at once.
  void queryClient.invalidateQueries({ queryKey: ['reports', wsId] });
  // Stream tree (per-stream report counts).
  void queryClient.invalidateQueries({ queryKey: queryKeys.tree(wsId) });
  // Widget data for the affected stream: metric latest/series scoped to the
  // stream; report-count and alert-feed scoped to the workspace (prefix).
  void queryClient.invalidateQueries({ queryKey: ['metric-latest', wsId, payload.streamId] });
  void queryClient.invalidateQueries({ queryKey: ['metric-series', wsId, payload.streamId] });
  void queryClient.invalidateQueries({ queryKey: ['report-count', wsId] });
  void queryClient.invalidateQueries({ queryKey: ['alert-feed', wsId] });
  // Reports are immutable: an existing detail never changes. Only invalidate the
  // exact report detail (harmless; primes the cache if it was an optimistic gap).
  void queryClient.invalidateQueries({ queryKey: queryKeys.report(wsId, payload.reportId) });
}

/**
 * Invalidate the keys affected by an archive/unarchive/delete on OTHER tabs.
 * Covers every report list scope (active feed, archived view, search) via the
 * `['reports', wsId]` prefix, plus the tree counts.
 */
function invalidateForLifecycle(wsId: string, payload: ReportLifecyclePayload): void {
  void queryClient.invalidateQueries({ queryKey: ['reports', wsId] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.tree(wsId) });
  // A deleted report's detail can never resolve again; archived/unarchived ones
  // are unchanged, so invalidating their details is harmless.
  for (const reportId of payload.reportIds) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.report(wsId, reportId) });
  }
}

// --- Subscription hook ------------------------------------------------------

/**
 * Open exactly one SSE connection for the given workspace and invalidate query
 * keys on each push. Mount ONCE per workspace; re-subscribes on workspace
 * switch and closes the connection on unmount (no leak).
 */
export function useWorkspaceLiveUpdates(workspaceId: string | undefined): void {
  useEffect(() => {
    // CSR-only API; guard so module/SSR references never throw.
    if (!workspaceId || typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }

    // Same-origin URL → the session cookie is sent automatically.
    const source = new EventSource(`/api/v1/workspaces/${workspaceId}/events`);

    const handleReport = (event: MessageEvent<string>) => {
      let payload: ReportEventPayload;
      try {
        payload = JSON.parse(event.data) as ReportEventPayload;
      } catch {
        // Malformed payload — ignore, never crash.
        return;
      }
      if (!payload || typeof payload.streamId !== 'string') return;
      invalidateForReport(workspaceId, payload);
    };

    const handleLifecycle = (event: MessageEvent<string>) => {
      let payload: ReportLifecyclePayload;
      try {
        payload = JSON.parse(event.data) as ReportLifecyclePayload;
      } catch {
        return;
      }
      if (!payload || typeof payload.streamId !== 'string' || !Array.isArray(payload.reportIds)) {
        return;
      }
      invalidateForLifecycle(workspaceId, payload);
    };

    source.addEventListener('open', () => setConnected(true));
    source.addEventListener('report', handleReport as EventListener);
    // Archive/unarchive/delete lifecycle events (one named event per kind).
    source.addEventListener('report-archived', handleLifecycle as EventListener);
    source.addEventListener('report-unarchived', handleLifecycle as EventListener);
    source.addEventListener('report-deleted', handleLifecycle as EventListener);
    source.addEventListener('error', () => {
      // Network drop, 503 (sse_disabled), or proxy hiccup. EventSource
      // auto-reconnects; until it reopens, mark disconnected so polling resumes.
      // The endpoint doesn't replay backlog, so refetch the lists to fill any gap
      // once we know we're degraded.
      setConnected(false);
    });

    return () => {
      setConnected(false);
      source.close();
    };
  }, [workspaceId]);
}

/**
 * The refetch interval (ms) callers pass to `useQuery({ refetchInterval })`.
 *
 * While SSE is connected, pushes drive freshness so polling backs off to a
 * longer safety-net interval; otherwise it returns the normal poll interval.
 * Always returns a valid number — polling never fully stops.
 */
export function useLiveInterval(): number {
  const connected = useSseConnected();
  return connected ? SSE_FALLBACK_INTERVAL_MS : POLL_INTERVAL_MS;
}
