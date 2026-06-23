import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { WebhookDeliveryStatus } from '@/lib/api-types';
import { getWebhook, listWebhookDeliveries, redeliverWebhook } from '@/lib/api';
import { queryClient, queryKeys } from '@/lib/query-client';
import { useCurrentWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorState, SkeletonRows, errorMessage } from '@/components/common/states';
import { RelativeTime } from '@/components/common/relative-time';
import { toast } from '@/components/ui/sonner';
import { WebhooksCard } from '@/components/webhooks/webhooks-card';

/** Webhooks tab — the list + create/edit lives in WebhooksCard. */
export function WebhooksSettingsPage() {
  const { workspace } = useCurrentWorkspace();
  return <WebhooksCard wsId={workspace.id} />;
}

const STATUS_VARIANT: Record<WebhookDeliveryStatus, 'healthy' | 'critical' | 'neutral' | 'info'> = {
  success: 'healthy',
  failed: 'critical',
  pending: 'neutral',
  delivering: 'info',
};

/** Full-page delivery log for one webhook (a settings sub-page). */
export function WebhookDeliveriesPage() {
  const { workspace } = useCurrentWorkspace();
  const { webhookId } = useParams({ strict: false }) as { webhookId: string };
  const wsId = workspace.id;

  const webhook = useQuery({
    queryKey: queryKeys.webhook(wsId, webhookId),
    queryFn: ({ signal }) => getWebhook(wsId, webhookId, signal),
    select: (r) => r.webhook,
  });

  const deliveries = useInfiniteQuery({
    queryKey: queryKeys.webhookDeliveries(wsId, webhookId),
    queryFn: ({ pageParam, signal }) =>
      listWebhookDeliveries(wsId, webhookId, pageParam, 20, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const redeliver = useMutation({
    mutationFn: (deliveryId: string) => redeliverWebhook(wsId, webhookId, deliveryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.webhookDeliveries(wsId, webhookId),
      });
      toast('Re-queued for delivery');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const items = deliveries.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link
          to="/w/$ws/settings/webhooks"
          params={{ ws: workspace.slug }}
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to webhooks
        </Link>
        <h2 className="text-lg font-semibold tracking-tight">
          Delivery log{webhook.data ? ` — ${webhook.data.name}` : ''}
        </h2>
        <p className="text-sm text-muted-foreground">Every delivery attempt, newest first.</p>
      </div>

      {deliveries.isPending ? (
        <SkeletonRows rows={6} />
      ) : deliveries.isError ? (
        <ErrorState error={deliveries.error} onRetry={() => deliveries.refetch()} />
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No deliveries yet.</p>
      ) : (
        <>
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            {items.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                <Badge variant={STATUS_VARIANT[d.status]} className="shrink-0 capitalize">
                  {d.status}
                </Badge>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs">
                    {d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : (d.lastError ?? '—')}
                    {d.attempts > 1 ? ` · ${d.attempts} attempts` : ''}
                  </span>
                  <span className="text-[0.6875rem] text-muted-foreground">
                    <RelativeTime value={d.deliveredAt ?? d.createdAt} />
                  </span>
                </div>
                {d.status === 'success' || d.status === 'failed' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => redeliver.mutate(d.id)}
                    disabled={redeliver.isPending}
                  >
                    <RefreshCw className="size-3.5" /> Redeliver
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          {deliveries.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              className="self-center"
              onClick={() => deliveries.fetchNextPage()}
              disabled={deliveries.isFetchingNextPage}
            >
              {deliveries.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
