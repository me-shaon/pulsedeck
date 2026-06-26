import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Eye,
  EyeOff,
  KeyRound,
  MoreHorizontal,
  Plus,
  Radio,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { Source, SourceScope } from '@/lib/api-types';
import { createSource, reissueToken, revokeSource, rotateKey } from '@/lib/api';
import { queryClient, queryKeys } from '@/lib/query-client';
import { useCurrentWorkspace, canManage } from '@/lib/workspace-context';
import { useSources } from '@/hooks/use-workspace-data';
import { PageContainer, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Mono } from '@/components/ui/mono';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, SkeletonRows, errorMessage } from '@/components/common/states';
import { RelativeTime } from '@/components/common/relative-time';
import { toast } from '@/components/ui/sonner';
import { SOURCE_STATUS } from '@/lib/domain';
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

/** Source management: connected agents, add source, re-issue / rotate / revoke. */
export function SourcesPage() {
  const { workspace, role } = useCurrentWorkspace();
  const manage = canManage(role);
  const sources = useSources(workspace.id);

  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<SecretRevealData | null>(null);
  const [confirm, setConfirm] = useState<{ source: Source } | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  // Revoked sources are deliberately disabled — hide them by default so the
  // list shows live agents, with a toggle to reveal them when needed.
  const all = sources.data ?? [];
  const revokedCount = all.filter((s) => s.status === 'revoked').length;
  const visible = showRevoked ? all : all.filter((s) => s.status !== 'revoked');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.sources(workspace.id) });

  const reissue = useMutation({
    mutationFn: (sourceId: string) => reissueToken(workspace.id, sourceId),
    onSuccess: (res) => {
      void invalidate();
      setSecret({
        title: 'New registration token',
        description: 'Hand this token to the agent to register. The previous token is now invalid.',
        secret: res.registrationToken,
        secretLabel: 'Registration token',
        prompt: res.setupPrompt,
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rotate = useMutation({
    mutationFn: (sourceId: string) => rotateKey(workspace.id, sourceId),
    onSuccess: (res) => {
      void invalidate();
      setSecret({
        title: 'API key rotated',
        description: 'Update the agent with this new key. The old key no longer works.',
        secret: res.api_key,
        secretLabel: 'API key',
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const revoke = useMutation({
    mutationFn: (sourceId: string) => revokeSource(workspace.id, sourceId),
    onSuccess: () => {
      void invalidate();
      toast('Source revoked');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <PageContainer>
      <PageHeader
        title="Sources"
        description="Connected agents pushing reports into this workspace."
        actions={
          manage ? (
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Add source
            </Button>
          ) : undefined
        }
      />

      {sources.isPending ? (
        <SkeletonRows rows={4} />
      ) : sources.isError ? (
        <ErrorState error={sources.error} onRetry={() => sources.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="No sources yet"
          description="Add a source to generate a registration token and connect an agent."
          action={
            manage ? (
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" /> Add source
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {revokedCount > 0 ? (
            <div className="flex items-center justify-between gap-2 px-1 pb-1">
              <span className="text-[0.6875rem] text-muted-foreground">
                {showRevoked
                  ? `Showing ${revokedCount} revoked ${revokedCount === 1 ? 'source' : 'sources'}.`
                  : `${revokedCount} revoked ${revokedCount === 1 ? 'source' : 'sources'} hidden.`}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setShowRevoked((v) => !v)}>
                {showRevoked ? (
                  <>
                    <EyeOff className="size-3.5" /> Hide revoked
                  </>
                ) : (
                  <>
                    <Eye className="size-3.5" /> Show revoked
                  </>
                )}
              </Button>
            </div>
          ) : null}
          {visible.map((source) => {
            const meta = SOURCE_STATUS[source.status];
            return (
              <div
                key={source.id}
                className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{source.name}</span>
                    <Badge variant={meta.variant} dot className="shrink-0">
                      {meta.label}
                    </Badge>
                    <Badge variant="outline" className="shrink-0 capitalize">
                      {source.scope}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.6875rem] text-muted-foreground">
                    <Mono className="text-[0.6875rem]" title={source.id}>
                      {source.id}
                    </Mono>
                    <span aria-hidden>·</span>
                    <span>
                      {source.lastSeenAt ? (
                        <>
                          last seen <RelativeTime value={source.lastSeenAt} />
                        </>
                      ) : (
                        'never connected'
                      )}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">{source.reportCount} reports</span>
                    <span aria-hidden>·</span>
                    <span>
                      schema <Mono className="text-[0.6875rem]">v{source.schemaVersion}</Mono>
                    </span>
                    {source.agentVersion ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>
                          agent <Mono className="text-[0.6875rem]">{source.agentVersion}</Mono>
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>

                {manage ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${source.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => reissue.mutate(source.id)}
                        disabled={reissue.isPending}
                      >
                        <KeyRound className="size-4" /> Re-issue registration token
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => rotate.mutate(source.id)}
                        disabled={rotate.isPending}
                      >
                        <RefreshCw className="size-4" /> Rotate API key
                      </DropdownMenuItem>
                      {source.status !== 'revoked' ? (
                        <DropdownMenuItem
                          onSelect={() => setConfirm({ source })}
                          className="text-severity-critical"
                        >
                          <Trash2 className="size-4" /> Revoke
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <CreateSourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        wsId={workspace.id}
        onCreated={(data) => {
          void invalidate();
          setSecret(data);
        }}
      />

      <SecretRevealDialog data={secret} onClose={() => setSecret(null)} />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => (!open ? setConfirm(null) : undefined)}
        title={`Revoke ${confirm?.source.name ?? 'source'}?`}
        description="The agent's API key stops working immediately. Existing reports are kept. This can't be undone."
        confirmLabel="Revoke source"
        onConfirm={async () => {
          if (confirm) await revoke.mutateAsync(confirm.source.id);
        }}
      />
    </PageContainer>
  );
}

function CreateSourceDialog({
  open,
  onOpenChange,
  wsId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  onCreated: (data: SecretRevealData) => void;
}) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<SourceScope>('workspace');

  const mutation = useMutation({
    mutationFn: () => createSource(wsId, { name, scope }),
    onSuccess: (res) => {
      onOpenChange(false);
      setName('');
      setScope('workspace');
      onCreated({
        title: 'Source created',
        description: 'Give this registration token to the agent to connect it.',
        secret: res.registrationToken,
        secretLabel: 'Registration token',
        prompt: res.setupPrompt,
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add source</DialogTitle>
          <DialogDescription>
            Creates a source and a one-time registration token for an agent.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="CI deploy bot"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Write scope</span>
            <Select value={scope} onValueChange={(v) => setScope(v as SourceScope)}>
              <SelectTrigger aria-label="Write scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">Workspace — any stream</SelectItem>
                <SelectItem value="category">Category — assigned categories</SelectItem>
                <SelectItem value="stream">Stream — assigned streams</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create source'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
