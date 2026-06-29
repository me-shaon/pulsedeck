import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { getAuthConfig } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { requestPasswordReset } from '@/lib/auth-client';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Request a password-reset link. Always shows a generic confirmation (never
 * reveals whether the email exists → no account enumeration). When the server
 * reports email delivery isn't configured, warns up front that the link won't
 * arrive — the OSS self-host admin must set the `SMTP_*` env to enable it.
 */
export function ForgotPasswordPage() {
  const config = useQuery({
    queryKey: queryKeys.authConfig,
    queryFn: ({ signal }) => getAuthConfig(signal),
  });
  const emailUnconfigured = config.data?.emailConfigured === false;

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // Ignore the result on purpose: a generic confirmation is shown either way
    // so the response can't be used to probe which emails have accounts.
    await requestPasswordReset({ email, redirectTo: '/reset-password' }).catch(() => undefined);
    setSubmitting(false);
    setSubmitted(true);
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Enter your email and we'll send you a reset link."
      footer={
        <Link to="/login" className="hover:text-foreground hover:underline">
          Back to sign in
        </Link>
      }
    >
      {emailUnconfigured ? (
        <div
          role="alert"
          className="mb-4 flex gap-2 rounded-md border border-[var(--severity-warning)]/40 bg-[var(--tint-amber-bg)] p-3 text-xs"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-severity-warning" aria-hidden />
          <p>
            Email delivery is not configured on this server, so the reset link won't be sent.
            Contact your administrator to recover your account.
          </p>
        </div>
      ) : null}

      {submitted ? (
        <p className="text-sm text-muted-foreground">
          If that email exists, a password reset link is on its way. Check your inbox.
        </p>
      ) : (
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
          <Button type="submit" variant="primary" className="mt-1 w-full" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
