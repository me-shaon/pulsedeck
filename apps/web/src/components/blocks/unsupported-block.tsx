import { HelpCircle } from 'lucide-react';
import { Mono } from '@/components/ui/mono';

/**
 * Forward-compat fallback. The wire contract is additive within 1.x (new block
 * types + enum values can appear before this client knows them). Rather than
 * crash, we render a quiet, honest placeholder naming the unknown type.
 */
export function UnsupportedBlock({ type }: { type: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border bg-surface/40 px-3.5 py-3 text-muted-foreground">
      <HelpCircle className="size-4 shrink-0" aria-hidden />
      <span className="text-xs">
        Unsupported block <Mono className="text-[0.6875rem]">{type || 'unknown'}</Mono> — update
        PulseDeck to view this content.
      </span>
    </div>
  );
}
