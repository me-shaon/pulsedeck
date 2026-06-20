import { Component, type ReactNode } from 'react';
import type {
  AlertBlock as AlertBlockT,
  ArtifactBlock as ArtifactBlockT,
  Block,
  BlockType,
  ChartBlock as ChartBlockT,
  MarkdownBlock as MarkdownBlockT,
  MetricBlock as MetricBlockT,
  StatusBlock as StatusBlockT,
  TableBlock as TableBlockT,
  TimelineBlock as TimelineBlockT,
} from '@pulsedeck/schema';
import { MetricBlock } from './metric-block';
import { MarkdownBlock } from './markdown-block';
import { ChartBlock } from './chart-block';
import { TableBlock } from './table-block';
import { TimelineBlock } from './timeline-block';
import { AlertBlock } from './alert-block';
import { StatusBlock } from './status-block';
import { ArtifactBlock } from './artifact-block';
import { UnsupportedBlock } from './unsupported-block';

/**
 * Block renderer registry — keyed by `block.type`, one component per type,
 * mirroring the schema discriminated union. New/unknown types resolve to the
 * forward-compatible {@link UnsupportedBlock} fallback (the wire contract is
 * additive within 1.x).
 */
const REGISTRY: Record<BlockType, (block: Block) => ReactNode> = {
  metric: (b) => <MetricBlock block={b as MetricBlockT} />,
  markdown: (b) => <MarkdownBlock block={b as MarkdownBlockT} />,
  chart: (b) => <ChartBlock block={b as ChartBlockT} />,
  table: (b) => <TableBlock block={b as TableBlockT} />,
  timeline: (b) => <TimelineBlock block={b as TimelineBlockT} />,
  alert: (b) => <AlertBlock block={b as AlertBlockT} />,
  status: (b) => <StatusBlock block={b as StatusBlockT} />,
  artifact: (b) => <ArtifactBlock block={b as ArtifactBlockT} />,
};

/** Isolate render failures so one malformed block can't blank the report. */
class BlockErrorBoundary extends Component<
  { type: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) return <UnsupportedBlock type={this.props.type} />;
    return this.props.children;
  }
}

export function BlockRenderer({ block }: { block: Block }) {
  const type = (block as { type?: string }).type ?? '';
  const render = (REGISTRY as Record<string, ((b: Block) => ReactNode) | undefined>)[type];
  if (!render) return <UnsupportedBlock type={type} />;
  return <BlockErrorBoundary type={type}>{render(block)}</BlockErrorBoundary>;
}

/** Render a flat, sequential list of blocks in the order received. */
export function BlockList({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-6">
      {blocks.map((block, i) => (
        <BlockRenderer key={(block as { id?: string }).id ?? i} block={block} />
      ))}
    </div>
  );
}
