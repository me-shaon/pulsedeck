import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Activity,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook as WebhookIcon,
} from 'lucide-react';
import type { Severity } from '@pulsedeck/schema';
import type { Webhook, WebhookFormat } from '@/lib/api-types';
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  rotateWebhookSecret,
  testWebhook,
  updateWebhook,
  type WebhookInput,
} from '@/lib/api';
import { queryClient, queryKeys } from '@/lib/query-client';
import { useCurrentWorkspace } from '@/lib/workspace-context';
import { useTree } from '@/hooks/use-workspace-data';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { MultiSelect } from '@/components/ui/multi-select';
import { Mono } from '@/components/ui/mono';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, SkeletonRows, errorMessage } from '@/components/common/states';
import { toast } from '@/components/ui/sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import {
  SecretRevealDialog,
  type SecretRevealData,
} from '@/components/sources/secret-reveal-dialog';

const SEVERITIES: Severity[] = ['info', 'warning', 'critical'];

const FORMATS: { value: WebhookFormat; label: string }[] = [
  { value: 'generic', label: 'Generic JSON (signed)' },
  { value: 'slack', label: 'Slack' },
  { value: 'discord', label: 'Discord' },
  { value: 'mattermost', label: 'Mattermost' },
];

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Workspace webhook management (gated by the caller to owner/admin). Lists
 * webhooks, drives create/edit/test/rotate/delete, and opens a per-webhook
 * delivery-log dialog. The signing secret is revealed once (generic only).
 */
export function WebhooksCard({ wsId }: { wsId: string }) {
  const { workspace } = useCurrentWorkspace();
  const navigate = useNavigate();
  const webhooks = useQuery({
    queryKey: queryKeys.webhooks(wsId),
    queryFn: ({ signal }) => listWebhooks(wsId, signal),
    select: (r) => r.webhooks,
  });
  const tree = useTree(wsId);
  const categoryName = (id: string) => tree.data?.categories.find((c) => c.id === id)?.name ?? id;

  const [dialog, setDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; webhook: Webhook } | null
  >(null);
  const [secret, setSecret] = useState<SecretRevealData | null>(null);
  const [confirm, setConfirm] = useState<Webhook | null>(null);

  const openLog = (w: Webhook) =>
    navigate({
      to: '/w/$ws/settings/webhooks/$webhookId/deliveries',
      params: { ws: workspace.slug, webhookId: w.id },
    });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.webhooks(wsId) });

  const toggle = useMutation({
    mutationFn: (w: Webhook) => updateWebhook(wsId, w.id, { enabled: !w.enabled }),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rotate = useMutation({
    mutationFn: (w: Webhook) => rotateWebhookSecret(wsId, w.id),
    onSuccess: (res) =>
      setSecret({
        title: 'Signing secret rotated',
        description:
          'Update your endpoint to verify with this new secret. The old one no longer works.',
        secret: res.secret,
        secretLabel: 'Signing secret',
      }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sendTest = useMutation({
    mutationFn: (w: Webhook) => testWebhook(wsId, w.id),
    onSuccess: () => toast('Test delivery queued'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (w: Webhook) => deleteWebhook(wsId, w.id),
    onSuccess: () => {
      void invalidate();
      toast('Webhook deleted');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle>Webhooks</CardTitle>
          <CardDescription>
            Deliver matching reports to external endpoints (Slack, Discord, Mattermost, or signed
            JSON).
          </CardDescription>
        </div>
        <Button variant="primary" size="sm" onClick={() => setDialog({ mode: 'create' })}>
          <Plus className="size-4" /> Add webhook
        </Button>
      </CardHeader>
      <CardContent>
        {webhooks.isPending ? (
          <SkeletonRows rows={2} />
        ) : webhooks.isError ? (
          <ErrorState error={webhooks.error} onRetry={() => webhooks.refetch()} />
        ) : webhooks.data.length === 0 ? (
          <EmptyState
            icon={WebhookIcon}
            title="No webhooks yet"
            description="Add a webhook to forward alerts to a channel or an external service."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {webhooks.data.map((w) => (
              <div
                key={w.id}
                className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{w.name}</span>
                    <Badge variant="outline" className="shrink-0 capitalize">
                      {w.format}
                    </Badge>
                    <Badge variant={w.enabled ? 'healthy' : 'neutral'} dot className="shrink-0">
                      {w.enabled ? 'Enabled' : 'Paused'}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.6875rem] text-muted-foreground">
                    <Mono className="text-[0.6875rem]" title={w.url}>
                      {hostOf(w.url)}
                    </Mono>
                    <span aria-hidden>·</span>
                    <span>{w.severities.length ? w.severities.join(', ') : 'all severities'}</span>
                    <span aria-hidden>·</span>
                    <span>
                      {w.categoryIds.length
                        ? w.categoryIds.map(categoryName).join(', ')
                        : 'all categories'}
                    </span>
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Actions for ${w.name}`}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setDialog({ mode: 'edit', webhook: w })}>
                      <Pencil className="size-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openLog(w)}>
                      <Activity className="size-4" /> Delivery log
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => sendTest.mutate(w)}
                      disabled={sendTest.isPending}
                    >
                      <Send className="size-4" /> Send test
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => toggle.mutate(w)} disabled={toggle.isPending}>
                      {w.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}{' '}
                      {w.enabled ? 'Pause' : 'Enable'}
                    </DropdownMenuItem>
                    {w.format === 'generic' ? (
                      <DropdownMenuItem
                        onSelect={() => rotate.mutate(w)}
                        disabled={rotate.isPending}
                      >
                        <RefreshCw className="size-4" /> Rotate signing secret
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onSelect={() => setConfirm(w)}
                      className="text-severity-critical"
                    >
                      <Trash2 className="size-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {dialog ? (
        <WebhookDialog
          wsId={wsId}
          webhook={dialog.mode === 'edit' ? dialog.webhook : undefined}
          categories={tree.data?.categories ?? []}
          onOpenChange={(open) => (!open ? setDialog(null) : undefined)}
          onSaved={(reveal) => {
            void invalidate();
            setDialog(null);
            if (reveal) setSecret(reveal);
          }}
        />
      ) : null}

      <SecretRevealDialog data={secret} onClose={() => setSecret(null)} />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => (!open ? setConfirm(null) : undefined)}
        title={`Delete ${confirm?.name ?? 'webhook'}?`}
        description="It stops receiving events immediately and its delivery history is removed. This can't be undone."
        confirmLabel="Delete webhook"
        onConfirm={async () => {
          if (confirm) await remove.mutateAsync(confirm);
        }}
      />
    </Card>
  );
}

/** Toggle-button group (mirrors the report severity filter): empty set = all. */
function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  labelOf,
}: {
  options: T[];
  value: T[];
  onChange: (next: T[]) => void;
  label: string;
  labelOf?: (v: T) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {options.map((opt) => {
        const active = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? value.filter((x) => x !== opt) : [...value, opt])}
            className={cn(
              'flex h-8 items-center rounded-md border px-2.5 text-xs font-medium capitalize transition-colors',
              active
                ? 'border-brand bg-brand-tint text-brand'
                : 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground',
            )}
          >
            {labelOf ? labelOf(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}

function WebhookDialog({
  wsId,
  webhook,
  categories,
  onOpenChange,
  onSaved,
}: {
  wsId: string;
  webhook?: Webhook;
  categories: { id: string; name: string }[];
  onOpenChange: (open: boolean) => void;
  onSaved: (reveal: SecretRevealData | null) => void;
}) {
  const editing = Boolean(webhook);
  const [name, setName] = useState(webhook?.name ?? '');
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [format, setFormat] = useState<WebhookFormat>(webhook?.format ?? 'generic');
  const [severities, setSeverities] = useState<Severity[]>(webhook?.severities ?? []);
  const [categoryIds, setCategoryIds] = useState<string[]>(webhook?.categoryIds ?? []);
  const [enabled, setEnabled] = useState(webhook?.enabled ?? true);

  const save = useMutation({
    mutationFn: () => {
      const input: WebhookInput = { name, url, format, severities, categoryIds, enabled };
      return editing ? updateWebhook(wsId, webhook!.id, input) : createWebhook(wsId, input);
    },
    onSuccess: (res) => {
      const secret = (res.webhook as { secret?: string }).secret;
      if (!editing && format === 'generic' && secret) {
        onSaved({
          title: 'Webhook created',
          description:
            'Verify deliveries with this signing secret (sent as X-PulseDeck-Signature).',
          secret,
          secretLabel: 'Signing secret',
        });
      } else {
        toast(editing ? 'Webhook updated' : 'Webhook created');
        onSaved(null);
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit webhook' : 'Add webhook'}</DialogTitle>
          <DialogDescription>
            Choose what fires this webhook. Empty severity or category = match all.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Critical → #alerts"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Endpoint URL</span>
            <Input
              required
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/…"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Format</span>
            <Select value={format} onValueChange={(v) => setFormat(v as WebhookFormat)}>
              <SelectTrigger aria-label="Payload format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Severities</span>
            <ToggleGroup
              options={SEVERITIES}
              value={severities}
              onChange={setSeverities}
              label="Filter by severity"
            />
          </div>
          {categories.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Categories</span>
              <MultiSelect
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                value={categoryIds}
                onChange={setCategoryIds}
                ariaLabel="Filter by category"
                placeholder="Search categories…"
                emptyLabel="All categories"
              />
            </div>
          ) : null}
          <div className="flex items-center gap-2.5">
            <Switch
              id="wh-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Enabled"
            />
            <label htmlFor="wh-enabled" className="cursor-pointer text-sm font-medium">
              Enabled
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create webhook'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
