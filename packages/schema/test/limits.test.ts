import { describe, it, expect } from 'vitest';
import { LIMITS, MAX_PAYLOAD_BYTES, validateReport } from '../src/index.js';
import { reportWithBlocks } from './fixtures.js';

function ok(blocks: unknown[]): boolean {
  return validateReport(reportWithBlocks(blocks)).success;
}

function metric(i: number) {
  return { id: `m${i}`, type: 'metric', key: `k${i}`, label: `L${i}`, value: i };
}

describe('limit constants', () => {
  it('exposes the documented values', () => {
    expect(LIMITS.blocksPerReport).toBe(50);
    expect(LIMITS.tableRows).toBe(1000);
    expect(LIMITS.tableColumns).toBe(20);
    expect(LIMITS.chartSeries).toBe(10);
    expect(LIMITS.chartPointsPerSeries).toBe(500);
    expect(LIMITS.markdownChars).toBe(50_000);
    expect(MAX_PAYLOAD_BYTES).toBe(1_048_576);
  });
});

describe('blocks per report', () => {
  it('allows exactly 50', () => {
    expect(ok(Array.from({ length: 50 }, (_, i) => metric(i)))).toBe(true);
  });
  it('rejects 51', () => {
    expect(ok(Array.from({ length: 51 }, (_, i) => metric(i)))).toBe(false);
  });
});

describe('markdown length', () => {
  const md = (n: number) => ({ id: 'md', type: 'markdown', content: 'a'.repeat(n) });
  it('allows exactly 50,000 chars', () => {
    expect(ok([md(50_000)])).toBe(true);
  });
  it('rejects 50,001 chars', () => {
    expect(ok([md(50_001)])).toBe(false);
  });
});

describe('table rows', () => {
  const table = (n: number) => ({
    id: 't',
    type: 'table',
    columns: [{ key: 'a', label: 'A', type: 'number' }],
    rows: Array.from({ length: n }, () => ({ a: 1 })),
  });
  it('allows exactly 1000 rows', () => {
    expect(ok([table(1000)])).toBe(true);
  });
  it('rejects 1001 rows', () => {
    expect(ok([table(1001)])).toBe(false);
  });
});

describe('table columns', () => {
  const table = (n: number) => ({
    id: 't',
    type: 'table',
    columns: Array.from({ length: n }, (_, i) => ({
      key: `c${i}`,
      label: `C${i}`,
      type: 'string',
    })),
    rows: [],
  });
  it('allows exactly 20 columns', () => {
    expect(ok([table(20)])).toBe(true);
  });
  it('rejects 21 columns', () => {
    expect(ok([table(21)])).toBe(false);
  });
});

describe('chart series', () => {
  const chart = (n: number) => ({
    id: 'c',
    type: 'chart',
    variant: 'line',
    labels: ['a'],
    series: Array.from({ length: n }, (_, i) => ({ name: `s${i}`, data: [i] })),
  });
  it('allows exactly 10 series', () => {
    expect(ok([chart(10)])).toBe(true);
  });
  it('rejects 11 series', () => {
    expect(ok([chart(11)])).toBe(false);
  });
});

describe('chart points per series', () => {
  const chart = (n: number) => ({
    id: 'c',
    type: 'chart',
    variant: 'line',
    labels: Array.from({ length: n }, (_, i) => `l${i}`),
    series: [{ name: 's', data: Array.from({ length: n }, (_, i) => i) }],
  });
  it('allows exactly 500 points', () => {
    expect(ok([chart(500)])).toBe(true);
  });
  it('rejects 501 points', () => {
    expect(ok([chart(501)])).toBe(false);
  });
});
