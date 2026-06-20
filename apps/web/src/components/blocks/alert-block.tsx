import type { AlertBlock as AlertBlockT, Severity } from '@pulsedeck/schema';
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BlockFrame } from './block-frame';

/** alert — severity-styled banner. Colour + icon + label, never colour alone. */

const SEVERITY_STYLE: Record<
  Severity,
  { wrap: string; icon: typeof Info; iconClass: string; label: string }
> = {
  info: {
    wrap: 'border-[var(--severity-info)]/40 bg-[var(--tint-blue-bg)]',
    icon: Info,
    iconClass: 'text-severity-info',
    label: 'Info',
  },
  warning: {
    wrap: 'border-[var(--severity-warning)]/40 bg-[var(--tint-amber-bg)]',
    icon: AlertTriangle,
    iconClass: 'text-severity-warning',
    label: 'Warning',
  },
  critical: {
    wrap: 'border-[var(--severity-critical)]/45 bg-[var(--tint-red-bg)]',
    icon: OctagonAlert,
    iconClass: 'text-severity-critical',
    label: 'Critical',
  },
};

export function AlertBlock({ block }: { block: AlertBlockT }) {
  const style = SEVERITY_STYLE[block.severity] ?? SEVERITY_STYLE.info;
  const Icon = style.icon;
  return (
    <BlockFrame caption={block.caption}>
      <div
        role="note"
        className={cn('flex items-start gap-3 rounded-lg border px-3.5 py-3', style.wrap)}
      >
        <Icon className={cn('mt-0.5 size-4 shrink-0', style.iconClass)} aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-semibold text-foreground">
            <span className="sr-only">{style.label}: </span>
            {block.title}
          </p>
          {block.message ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{block.message}</p>
          ) : null}
        </div>
      </div>
    </BlockFrame>
  );
}
