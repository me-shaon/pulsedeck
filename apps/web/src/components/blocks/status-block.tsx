import type { StatusBlock as StatusBlockT } from '@pulsedeck/schema';
import { Mono } from '@/components/ui/mono';
import { StatusIndicator } from '@/components/common/status-indicator';
import { BlockFrame } from './block-frame';

/**
 * status — grid of keyed health items. Each tile shows the human label plus the
 * non-colour-only status treatment (dot + word). `key` is the machine id (mono).
 */
export function StatusBlock({ block }: { block: StatusBlockT }) {
  return (
    <BlockFrame title={block.title} caption={block.caption}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {block.items.map((item) => (
          <div
            key={item.key}
            className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2.5"
          >
            <span className="truncate text-sm font-medium text-foreground" title={item.label}>
              {item.label}
            </span>
            <StatusIndicator status={item.status} className="text-muted-foreground" />
            <Mono className="truncate text-[0.6875rem]" title={item.key}>
              {item.key}
            </Mono>
          </div>
        ))}
      </div>
    </BlockFrame>
  );
}
