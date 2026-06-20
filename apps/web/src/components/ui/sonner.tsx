import { type ComponentProps, type CSSProperties } from 'react';
import { Toaster as SonnerToaster, toast } from 'sonner';
import { useTheme } from '@/lib/theme';

/**
 * Toast surface (sonner), themed to PulseDeck tokens via CSS variables so it
 * follows light/dark automatically.
 */
function Toaster(props: ComponentProps<typeof SonnerToaster>) {
  const { theme } = useTheme();
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      gap={8}
      toastOptions={{
        classNames: {
          toast:
            'group rounded-md border border-border bg-surface text-foreground shadow-lg text-sm',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-surface-2 text-muted-foreground',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--surface)',
          '--normal-text': 'var(--ink)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster, toast };
