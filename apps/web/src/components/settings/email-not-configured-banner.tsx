import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { getAuthConfig } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { Mono } from '@/components/ui/mono';

/**
 * Admin-only notice shown in Settings when transactional email isn't configured.
 * Names the features that silently won't work (password-reset delivery, invite
 * emails) and points at the fix. Renders nothing for non-admins or once email is
 * configured. Gated on `manage` so non-admins never see infra guidance.
 */
export function EmailNotConfiguredBanner({ manage }: { manage: boolean }) {
  const config = useQuery({
    queryKey: queryKeys.authConfig,
    queryFn: ({ signal }) => getAuthConfig(signal),
    enabled: manage,
  });

  if (!manage || config.data?.emailConfigured !== false) return null;

  return (
    <div
      role="alert"
      className="flex gap-3 rounded-md border border-[var(--severity-warning)]/40 bg-[var(--tint-amber-bg)] p-4 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-severity-warning" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-medium">Email is not configured</p>
        <p className="text-muted-foreground">
          Without an email provider, password reset links and workspace invite emails can't be
          delivered. Set the <Mono className="text-xs">SMTP_*</Mono> environment variables (with{' '}
          <Mono className="text-xs">EMAIL_PROVIDER=smtp</Mono>) to enable them.
        </p>
      </div>
    </div>
  );
}
