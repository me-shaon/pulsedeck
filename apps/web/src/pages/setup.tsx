import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { setup } from '@/lib/api';
import { ApiError } from '@/lib/api';
import { invalidateAuth } from '@/lib/guards';
import { queryClient } from '@/lib/query-client';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * First-run wizard. Creates the admin account (which also creates the first
 * workspace and sets the session cookie), then routes into the app. The route
 * guard only allows reaching this page while `setupRequired` is true.
 */
export function SetupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await setup({ name, email, password });
      await invalidateAuth(queryClient);
      navigate({ to: '/' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('Setup has already been completed. Redirecting to sign in…');
        setTimeout(() => navigate({ to: '/login' }), 1200);
      } else {
        setError(err instanceof Error ? err.message : 'Setup failed.');
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Welcome to PulseDeck"
      description="Create the admin account to finish setup. This runs once."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Name</span>
          <Input
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada Lovelace"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Email</span>
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Password</span>
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="text-[0.6875rem] text-muted-foreground">At least 8 characters.</span>
        </label>

        {error ? (
          <p role="alert" className="text-xs text-severity-critical">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" className="mt-1 w-full" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create admin account'}
        </Button>
      </form>
    </AuthShell>
  );
}
