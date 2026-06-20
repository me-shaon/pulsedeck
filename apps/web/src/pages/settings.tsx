import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Mail, Trash2, UserPlus } from 'lucide-react';
import type { Role } from '@/lib/api-types';
import { createInvite, listInvites, listMembers, removeMember, updateMemberRole } from '@/lib/api';
import { ApiError } from '@/lib/api';
import { queryClient, queryKeys } from '@/lib/query-client';
import { canManage, useCurrentWorkspace } from '@/lib/workspace-context';
import { PageContainer, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Mono } from '@/components/ui/mono';
import { ErrorState, SkeletonRows, errorMessage } from '@/components/common/states';
import { RelativeTime } from '@/components/common/relative-time';
import { toast } from '@/components/ui/sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import {
  SecretRevealDialog,
  type SecretRevealData,
} from '@/components/sources/secret-reveal-dialog';

const ROLES: Role[] = ['owner', 'admin', 'editor', 'viewer'];

export function SettingsPage() {
  const { workspace, role } = useCurrentWorkspace();
  const manage = canManage(role);

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description={`Manage members and invites for ${workspace.name}.`}
      />
      <div className="flex flex-col gap-6">
        <MembersCard wsId={workspace.id} manage={manage} />
        {manage ? <InvitesCard wsId={workspace.id} /> : null}
      </div>
    </PageContainer>
  );
}

function MembersCard({ wsId, manage }: { wsId: string; manage: boolean }) {
  const members = useQuery({
    queryKey: queryKeys.members(wsId),
    queryFn: ({ signal }) => listMembers(wsId, signal),
    select: (r) => r.members,
  });

  const [toRemove, setToRemove] = useState<{ userId: string; name: string } | null>(null);

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      updateMemberRole(wsId, userId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(wsId) });
      toast('Role updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => removeMember(wsId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(wsId) });
      toast('Member removed');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>People with access to this workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        {members.isPending ? (
          <SkeletonRows rows={3} />
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={() => members.refetch()} />
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {members.data.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{m.name ?? m.email}</span>
                  <Mono className="truncate text-[0.6875rem]">{m.email}</Mono>
                </div>
                {manage ? (
                  <Select
                    value={m.role}
                    onValueChange={(v) => changeRole.mutate({ userId: m.userId, role: v as Role })}
                  >
                    <SelectTrigger className="w-28" aria-label={`Role for ${m.email}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r} className="capitalize">
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline" className="capitalize">
                    {m.role}
                  </Badge>
                )}
                {manage ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${m.email}`}
                    onClick={() => setToRemove({ userId: m.userId, name: m.name ?? m.email })}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(open) => (!open ? setToRemove(null) : undefined)}
        title={`Remove ${toRemove?.name ?? 'member'}?`}
        description="They lose access to this workspace immediately."
        confirmLabel="Remove member"
        onConfirm={async () => {
          if (toRemove) await remove.mutateAsync(toRemove.userId);
        }}
      />
    </Card>
  );
}

function InvitesCard({ wsId }: { wsId: string }) {
  const invites = useQuery({
    queryKey: queryKeys.invites(wsId),
    queryFn: ({ signal }) => listInvites(wsId, signal),
    select: (r) => r.invites,
    retry: false,
  });

  const [role, setRole] = useState<Role>('viewer');
  const [reveal, setReveal] = useState<SecretRevealData | null>(null);

  const create = useMutation({
    mutationFn: () => createInvite(wsId, { role }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invites(wsId) });
      setReveal({
        title: 'Invite link created',
        description: 'Share this link with the person you want to invite.',
        secret: res.invite.inviteUrl,
        secretLabel: 'Invite link',
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // GET invites requires members:manage; render a graceful note on 403.
  const forbidden = invites.error instanceof ApiError && invites.error.status === 403;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invites</CardTitle>
        <CardDescription>Create a shareable invite link for a role.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
              Role
            </span>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger className="w-32" aria-label="Invite role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Button
            variant="primary"
            size="sm"
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            <UserPlus className="size-4" /> {create.isPending ? 'Creating…' : 'Create invite link'}
          </Button>
        </div>

        {invites.isPending ? (
          <SkeletonRows rows={2} />
        ) : forbidden ? (
          <p className="text-xs text-muted-foreground">
            You don’t have permission to view invites.
          </p>
        ) : invites.isError ? (
          <ErrorState error={invites.error} onRetry={() => invites.refetch()} />
        ) : invites.data.length === 0 ? (
          <p className="text-xs text-muted-foreground">No pending invites.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {invites.data.map((inv) => {
              const used = inv.acceptedAt !== null;
              const expired = !used && new Date(inv.expiresAt).getTime() < Date.now();
              return (
                <div key={inv.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm">
                      {inv.email ?? 'Anyone with the link'}{' '}
                      <Badge variant="outline" className="ml-1 capitalize">
                        {inv.role}
                      </Badge>
                    </span>
                    <span className="text-[0.6875rem] text-muted-foreground">
                      {used ? (
                        <>
                          accepted <RelativeTime value={inv.acceptedAt!} />
                        </>
                      ) : expired ? (
                        'expired'
                      ) : (
                        <>
                          expires <RelativeTime value={inv.expiresAt} />
                        </>
                      )}
                    </span>
                  </div>
                  <Badge variant={used ? 'healthy' : expired ? 'down' : 'neutral'}>
                    {used ? 'Accepted' : expired ? 'Expired' : 'Pending'}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <SecretRevealDialog data={reveal} onClose={() => setReveal(null)} />
    </Card>
  );
}
