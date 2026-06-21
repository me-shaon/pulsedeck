import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { authClient, useSession } from '@/lib/auth-client';
import { PageContainer, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mono } from '@/components/ui/mono';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SkeletonRows } from '@/components/common/states';
import { toast } from '@/components/ui/sonner';

/**
 * Account settings — identity-scoped (the signed-in user), distinct from the
 * workspace Settings page. Name + password are editable here; email is shown
 * read-only because the deployment has no email-verification transport wired.
 */
export function AccountPage() {
  const { data, isPending } = useSession();
  const user = data?.user;

  return (
    <PageContainer>
      <PageHeader title="Account" description="Manage your personal profile and password." />
      {isPending || !user ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="flex flex-col gap-6">
          <ProfileCard name={user.name ?? ''} email={user.email} />
          <PasswordCard />
        </div>
      )}
    </PageContainer>
  );
}

function ProfileCard({ name, email }: { name: string; email: string }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);

  const save = useMutation({
    mutationFn: async (next: string) => {
      const { error } = await authClient.updateUser({ name: next });
      if (error) throw new Error(error.message ?? 'Could not update profile.');
    },
    onSuccess: () => toast('Profile updated'),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update profile.'),
  });

  const trimmed = value.trim();
  const dirty = trimmed.length > 0 && trimmed !== name;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (dirty) save.mutate(trimmed);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your name and sign-in email.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input
              autoComplete="name"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Ada Lovelace"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Email</span>
            <Mono className="flex h-8 items-center rounded-md border border-input bg-surface-2 px-2.5 text-sm text-muted-foreground">
              {email}
            </Mono>
          </label>
          <div>
            <Button type="submit" variant="primary" size="sm" disabled={!dirty || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const change = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });
      if (error) throw new Error(error.message ?? 'Could not change password.');
    },
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      toast('Password changed. Other sessions were signed out.');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not change password.'),
  });

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && next !== confirm;
  const valid = current.length > 0 && next.length >= 8 && next === confirm;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (valid) change.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing it signs out your other sessions.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Current password</span>
            <Input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">New password</span>
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            {tooShort ? (
              <span className="text-xs text-severity-critical">Use at least 8 characters.</span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Confirm new password</span>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {mismatch ? (
              <span className="text-xs text-severity-critical">Passwords don’t match.</span>
            ) : null}
          </label>
          <div>
            <Button type="submit" variant="primary" size="sm" disabled={!valid || change.isPending}>
              {change.isPending ? 'Changing…' : 'Change password'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
