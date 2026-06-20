import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Plus } from 'lucide-react';
import { createWorkspace } from '@/lib/api';
import { queryClient, queryKeys } from '@/lib/query-client';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkspaces } from '@/hooks/use-workspace-data';

/**
 * Create-a-workspace screen. Doubles as the "no workspace" landing (a signed-in
 * user with zero memberships is routed here so the app is never a dead end).
 */
export function NewWorkspacePage() {
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const existing = workspaces.data ?? [];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { workspace } = await createWorkspace(name);
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      navigate({ to: '/w/$ws', params: { ws: workspace.slug } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workspace.');
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="New workspace"
      description="A workspace holds your streams, sources, and reports."
      footer={
        existing.length > 0 ? (
          <span>
            Or go to an existing one from the{' '}
            <Link to="/" className="text-brand hover:underline">
              switcher
            </Link>
            .
          </span>
        ) : null
      }
    >
      {existing.length > 0 ? (
        <div className="mb-4 flex flex-col gap-1.5">
          <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
            Your workspaces
          </span>
          {existing.map((w) => (
            <Link
              key={w.id}
              to="/w/$ws"
              params={{ ws: w.slug }}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
            >
              <span className="truncate font-medium">{w.name}</span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Workspace name</span>
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Platform"
          />
        </label>
        {error ? (
          <p role="alert" className="text-xs text-severity-critical">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
          <Plus className="size-4" /> {submitting ? 'Creating…' : 'Create workspace'}
        </Button>
      </form>
    </AuthShell>
  );
}
