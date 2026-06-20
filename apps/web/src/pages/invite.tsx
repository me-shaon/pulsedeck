import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { acceptInvite, listWorkspaces } from '@/lib/api';
import { queryClient, queryKeys } from '@/lib/query-client';
import { errorMessage } from '@/components/common/states';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';

/** Accepts a workspace invite token, then routes into the joined workspace. */
export function InvitePage() {
  const navigate = useNavigate();
  const { token } = useSearch({ from: '/invite' });
  const [status, setStatus] = useState<'working' | 'error'>('working');
  const [message, setMessage] = useState<string>('Joining workspace…');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setStatus('error');
      setMessage('This invite link is missing its token.');
      return;
    }
    (async () => {
      try {
        const { workspaceId } = await acceptInvite(token);
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
        const { workspaces } = await queryClient.fetchQuery({
          queryKey: queryKeys.workspaces,
          queryFn: () => listWorkspaces(),
        });
        const joined = workspaces.find((w) => w.id === workspaceId);
        navigate(joined ? { to: '/w/$ws', params: { ws: joined.slug } } : { to: '/' });
      } catch (err) {
        setStatus('error');
        setMessage(errorMessage(err));
      }
    })();
  }, [token, navigate]);

  return (
    <AuthShell
      title="Workspace invite"
      description={status === 'working' ? undefined : 'Couldn’t join'}
    >
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <p className="text-sm text-muted-foreground">{message}</p>
        {status === 'error' ? (
          <Button variant="outline" onClick={() => navigate({ to: '/' })}>
            Back to PulseDeck
          </Button>
        ) : null}
      </div>
    </AuthShell>
  );
}
