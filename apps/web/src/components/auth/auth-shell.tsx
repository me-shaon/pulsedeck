import type { ReactNode } from 'react';
import { PulseLine } from '@/components/pulse-line';
import { Logo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';

/** Centered, branded frame for the unauthenticated screens (login / setup). */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <div className="flex items-center justify-between px-4 py-3 sm:px-6">
        <Logo />
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex justify-center opacity-90">
            <PulseLine width={220} height={36} beats={4} speed={5} />
          </div>
          <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
            <div className="mb-5 flex flex-col gap-1">
              <h1 className="font-display text-lg font-semibold tracking-tight">{title}</h1>
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
            {children}
          </div>
          {footer ? (
            <div className="mt-4 text-center text-xs text-muted-foreground">{footer}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
