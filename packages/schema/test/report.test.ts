import { describe, it, expect } from 'vitest';
import { reportSchema, validateReport } from '../src/index.js';
import { canonicalReport, reportWithBlocks } from './fixtures.js';

describe('report envelope', () => {
  it('accepts the canonical PRD example', () => {
    const result = reportSchema.safeParse(canonicalReport);
    expect(result.success).toBe(true);
  });

  it('validateReport returns parsed data on success', () => {
    const result = validateReport(canonicalReport);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.report.title).toBe('Daily Infrastructure Summary');
    }
  });

  it('requires version to be the literal 1.0', () => {
    const bad = { ...canonicalReport, version: '2.0' };
    const result = validateReport(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === 'version')).toBe(true);
    }
  });

  it('requires source.id', () => {
    const result = validateReport({
      ...reportWithBlocks([]),
      source: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === 'source.id')).toBe(true);
    }
  });

  it('requires report.occurred_at to be a valid ISO datetime', () => {
    const result = validateReport({
      ...reportWithBlocks([]),
      report: { title: 'x', occurred_at: 'not-a-date' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === 'report.occurred_at')).toBe(true);
    }
  });

  it('allows an empty blocks array and optional report fields', () => {
    const result = validateReport(reportWithBlocks([]));
    expect(result.success).toBe(true);
  });
});
