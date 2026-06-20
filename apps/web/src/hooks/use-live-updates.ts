import { POLL_INTERVAL_MS } from '@/lib/query-client';

/**
 * Realtime seam (Phase 10).
 *
 * Today PulseDeck stays fresh by polling — every list/detail query refetches on
 * this interval (and on window focus). When SSE lands, this hook is where a
 * `new EventSource('/api/v1/.../events')` subscription will live: on a push it
 * will call `queryClient.invalidateQueries`/`setQueryData` and return `0` here
 * so polling backs off to a safety net. The query layer needs no other changes.
 *
 * @returns the refetch interval (ms) callers pass to `useQuery({ refetchInterval })`.
 */
export function useLiveInterval(): number {
  // Intentionally static for now. The SSE subscription will replace this.
  return POLL_INTERVAL_MS;
}
