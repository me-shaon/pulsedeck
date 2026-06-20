import { useState, type FormEvent } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Github } from 'lucide-react';
import { getAuthConfig } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { invalidateAuth } from '@/lib/guards';
import { queryClient } from '@/lib/query-client';
import { signIn } from '@/lib/auth-client';
import { errorMessage } from '@/components/common/states';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: '/login' });
  const config = useQuery({
    queryKey: queryKeys.authConfig,
    queryFn: ({ signal }) => getAuthConfig(signal),
  });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await signIn.email({ email, password });
    if (signInError) {
      setError(signInError.message ?? 'Invalid email or password.');
      setSubmitting(false);
      return;
    }
    await invalidateAuth(queryClient);
    navigate({ to: redirect ?? '/' });
  }

  function signInWithGithub() {
    void signIn.social({ provider: 'github', callbackURL: window.location.origin });
  }

  return (
    <AuthShell title="Sign in" description="Welcome back to your briefing.">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Email</span>
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Password</span>
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error ? (
          <p role="alert" className="text-xs text-severity-critical">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" className="mt-1 w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      {config.data?.githubEnabled ? (
        <>
          <div className="my-4 flex items-center gap-3 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button variant="outline" className="w-full" onClick={signInWithGithub} type="button">
            <Github className="size-4" /> Continue with GitHub
          </Button>
        </>
      ) : config.isError ? (
        <p className="mt-3 text-xs text-muted-foreground">{errorMessage(config.error)}</p>
      ) : null}
    </AuthShell>
  );
}
