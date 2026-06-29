import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { resetPassword } from '@/lib/auth-client';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Complete a password reset. The opaque token arrives in the URL (set by the
 * emailed link → `/reset-password?token=…`). A missing token means the link was
 * malformed or already consumed; better-auth rejects expired/invalid tokens on
 * submit, which we surface inline.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token } = useSearch({ from: '/reset-password' });

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!token) {
    return (
      <AuthShell
        title="Reset your password"
        description="This password reset link is invalid or expired."
        footer={
          <Link to="/login" className="hover:text-foreground hover:underline">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Request a new link from the{' '}
          <Link to="/forgot-password" className="text-brand hover:underline">
            forgot password
          </Link>{' '}
          page.
        </p>
      </AuthShell>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    const { error: resetError } = await resetPassword({ newPassword: password, token });
    if (resetError) {
      setError(resetError.message ?? 'Could not reset your password. The link may have expired.');
      setSubmitting(false);
      return;
    }
    navigate({ to: '/login' });
  }

  return (
    <AuthShell title="Choose a new password" description="Enter a new password for your account.">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">New password</span>
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Confirm password</span>
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>

        {error ? (
          <p role="alert" className="text-xs text-severity-critical">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" className="mt-1 w-full" disabled={submitting}>
          {submitting ? 'Resetting…' : 'Reset password'}
        </Button>
      </form>
    </AuthShell>
  );
}
