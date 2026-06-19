import { describe, it, expect } from 'vitest';
import { blockSchema, validateReport } from '../src/index.js';
import { reportWithBlocks } from './fixtures.js';

/** Parse a single block in isolation. */
function parseBlock(block: unknown) {
  return blockSchema.safeParse(block);
}

/** Validate a report containing exactly one block; return its issues. */
function issuesFor(block: unknown) {
  const result = validateReport(reportWithBlocks([block]));
  return result.success ? [] : result.issues;
}

describe('metric block', () => {
  const valid = {
    id: 'blk_lat',
    type: 'metric',
    key: 'api_latency_p95',
    label: 'Avg API Latency',
    value: 421,
    unit: 'ms',
    format: 'duration',
    precision: 0,
    trend: 'up',
    sentiment: 'negative',
    delta: 14,
    comparison_label: 'vs yesterday',
  };

  it('accepts a fully populated metric', () => {
    expect(parseBlock(valid).success).toBe(true);
  });

  it('rejects a non-number value at blocks[0].value', () => {
    const issues = issuesFor({ ...valid, value: '421' });
    expect(issues.some((i) => i.path === 'blocks[0].value')).toBe(true);
  });

  it('rejects a missing required key', () => {
    const withoutKey = {
      id: 'blk_lat',
      type: 'metric',
      label: 'Avg API Latency',
      value: 421,
    };
    expect(parseBlock(withoutKey).success).toBe(false);
  });
});

describe('markdown block', () => {
  it('accepts content', () => {
    expect(parseBlock({ id: 'b', type: 'markdown', content: '# Hi' }).success).toBe(true);
  });
  it('rejects missing content', () => {
    expect(parseBlock({ id: 'b', type: 'markdown' }).success).toBe(false);
  });
});

describe('chart block', () => {
  const valid = {
    id: 'blk_vol',
    type: 'chart',
    variant: 'line',
    title: 'Request Volume',
    labels: ['Mon', 'Tue', 'Wed'],
    x_axis: 'Day',
    y_axis: 'Requests',
    unit: 'req',
    series: [{ name: 'Requests', data: [120, 145, 98] }],
  };

  it('accepts a valid chart', () => {
    expect(parseBlock(valid).success).toBe(true);
  });

  it('rejects an unknown variant', () => {
    expect(parseBlock({ ...valid, variant: 'pie' }).success).toBe(false);
  });

  it('fails when series data length != labels length at blocks[0].series[0].data', () => {
    const bad = { ...valid, series: [{ name: 'Requests', data: [1, 2] }] };
    const issues = issuesFor(bad);
    expect(issues.some((i) => i.path === 'blocks[0].series[0].data')).toBe(true);
  });
});

describe('table block', () => {
  const valid = {
    id: 'blk_svc',
    type: 'table',
    columns: [
      { key: 'service', label: 'Service', type: 'string' },
      { key: 'latency', label: 'Latency', type: 'number', unit: 'ms' },
    ],
    rows: [
      { service: 'API', latency: 42 },
      { service: 'Worker', latency: 890 },
    ],
  };

  it('accepts a valid table', () => {
    expect(parseBlock(valid).success).toBe(true);
  });

  it('rejects a row with an unknown column key at blocks[0].rows[0].bogus', () => {
    const bad = {
      ...valid,
      rows: [{ service: 'API', latency: 42, bogus: 1 }],
    };
    const issues = issuesFor(bad);
    expect(issues.some((i) => i.path === 'blocks[0].rows[0].bogus')).toBe(true);
  });

  it('rejects an invalid column type', () => {
    const bad = { ...valid, columns: [{ key: 'service', label: 'Service', type: 'boolean' }] };
    expect(parseBlock(bad).success).toBe(false);
  });
});

describe('timeline block', () => {
  const valid = {
    id: 'blk_dep',
    type: 'timeline',
    events: [
      {
        time: '2026-05-22T09:00:00Z',
        label: 'Deploy started',
        description: 'v2.1',
        status: 'healthy',
      },
      { time: '2026-05-22T09:04:00Z', label: 'Deploy complete', status: 'healthy' },
    ],
  };

  it('accepts a valid timeline', () => {
    expect(parseBlock(valid).success).toBe(true);
  });

  it('rejects an event with a non-ISO time', () => {
    const bad = { ...valid, events: [{ time: 'yesterday', label: 'x' }] };
    expect(parseBlock(bad).success).toBe(false);
  });
});

describe('alert block', () => {
  it('accepts a valid alert', () => {
    expect(
      parseBlock({
        id: 'a',
        type: 'alert',
        severity: 'warning',
        title: 'High latency',
        message: 'x',
      }).success,
    ).toBe(true);
  });
  it('rejects a missing severity', () => {
    expect(parseBlock({ id: 'a', type: 'alert', title: 'x' }).success).toBe(false);
  });
  it('rejects a missing title', () => {
    expect(parseBlock({ id: 'a', type: 'alert', severity: 'info' }).success).toBe(false);
  });
});

describe('status block', () => {
  it('accepts valid items', () => {
    expect(
      parseBlock({
        id: 's',
        type: 'status',
        items: [{ key: 'api', label: 'API', status: 'healthy' }],
      }).success,
    ).toBe(true);
  });
  it('rejects an unknown status value', () => {
    expect(
      parseBlock({
        id: 's',
        type: 'status',
        items: [{ key: 'api', label: 'API', status: 'on-fire' }],
      }).success,
    ).toBe(false);
  });
});

describe('artifact block', () => {
  it('accepts a valid artifact', () => {
    expect(
      parseBlock({
        id: 'p',
        type: 'artifact',
        label: 'Full Audit Report',
        url: 'https://storage.example.com/audit.pdf',
        mime_type: 'application/pdf',
        size_bytes: 184320,
      }).success,
    ).toBe(true);
  });
  it('rejects a non-URL url', () => {
    expect(parseBlock({ id: 'p', type: 'artifact', label: 'x', url: 'not a url' }).success).toBe(
      false,
    );
  });
});

describe('discriminated union', () => {
  it('rejects an unknown block type', () => {
    const issues = issuesFor({ id: 'x', type: 'pie' });
    expect(issues.some((i) => i.path === 'blocks[0].type')).toBe(true);
  });
  it('rejects a block missing id', () => {
    expect(parseBlock({ type: 'markdown', content: 'x' }).success).toBe(false);
  });
});
