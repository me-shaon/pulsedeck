import type { Report } from '../src/index.js';

/** The canonical example report from the PRD "Canonical Report Schema". */
export const canonicalReport: Report = {
  version: '1.0',
  workspace: 'my-ecommerce-app',
  source: { id: 'src_hermes_prod' },
  category: { slug: 'engineering' },
  stream: { slug: 'daily-infra-reports' },
  report: {
    title: 'Daily Infrastructure Summary',
    summary: '2 incidents detected, avg latency up 14%.',
    severity: 'warning',
    occurred_at: '2026-05-22T10:00:00Z',
    tags: ['production', 'infra'],
  },
  blocks: [
    {
      id: 'blk_1',
      type: 'metric',
      key: 'api_latency',
      label: 'Avg API Latency',
      value: 421,
      unit: 'ms',
    },
    {
      id: 'blk_2',
      type: 'markdown',
      content: 'Latency increased 14% compared to yesterday.',
    },
    {
      id: 'blk_3',
      type: 'table',
      columns: [
        { key: 'service', label: 'Service', type: 'string' },
        { key: 'status', label: 'Status', type: 'string' },
      ],
      rows: [
        { service: 'API', status: 'Healthy' },
        { service: 'Worker', status: 'Warning' },
      ],
    },
  ],
};

/** Build a minimal valid report wrapping the given blocks. */
export function reportWithBlocks(blocks: unknown[]): Record<string, unknown> {
  return {
    version: '1.0',
    source: { id: 'src_x' },
    category: { slug: 'engineering' },
    stream: { slug: 'daily' },
    report: {
      title: 'Test Report',
      occurred_at: '2026-05-22T10:00:00Z',
    },
    blocks,
  };
}
