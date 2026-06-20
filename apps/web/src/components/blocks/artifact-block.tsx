import type { ArtifactBlock as ArtifactBlockT } from '@pulsedeck/schema';
import { Download, FileText } from 'lucide-react';
import { Mono } from '@/components/ui/mono';
import { humanizeBytes } from '@/lib/format';
import { BlockFrame } from './block-frame';

/**
 * artifact — a drill-down / download link to the source-of-truth data.
 *
 * SECURITY: rendered ONLY as `<a target="_blank" rel="noopener noreferrer">`.
 * The URL is never fetched by the client (and never server-side — SSRF guard);
 * we just surface the label and mime/size hints.
 */
export function ArtifactBlock({ block }: { block: ArtifactBlockT }) {
  const size =
    block.size_bytes !== undefined
      ? (() => {
          const { num, unit } = humanizeBytes(block.size_bytes!);
          return `${num} ${unit}`;
        })()
      : null;

  return (
    <BlockFrame title={block.title} caption={block.caption}>
      <a
        href={block.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-3 transition-colors hover:border-border-strong hover:bg-accent"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-muted-foreground">
          <FileText className="size-4" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{block.label}</span>
          {block.mime_type || size ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {block.mime_type ? <Mono className="text-[0.6875rem]">{block.mime_type}</Mono> : null}
              {block.mime_type && size ? <span aria-hidden>·</span> : null}
              {size ? <span className="tabular-nums">{size}</span> : null}
            </span>
          ) : null}
        </span>
        <Download
          className="ml-auto size-4 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </a>
    </BlockFrame>
  );
}
