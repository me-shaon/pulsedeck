import { describe, it, expect } from 'vitest';
import { formatPath, toIssues, validateReport, reportSchema } from '../src/index.js';
import { reportWithBlocks } from './fixtures.js';

describe('formatPath', () => {
  it('formats dot/bracket notation', () => {
    expect(formatPath(['blocks', 0, 'value'])).toBe('blocks[0].value');
    expect(formatPath(['report', 'occurred_at'])).toBe('report.occurred_at');
    expect(formatPath(['blocks', 2, 'series', 0, 'data'])).toBe('blocks[2].series[0].data');
    expect(formatPath([])).toBe('');
  });
});

describe('toIssues', () => {
  it('produces the PRD wire shape { path, message }', () => {
    const bad = reportWithBlocks([
      { id: 'blk_1', type: 'metric', key: 'k', label: 'L', value: '421' },
    ]);
    const result = reportSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = toIssues(result.error);
      const valueIssue = issues.find((i) => i.path === 'blocks[0].value');
      expect(valueIssue).toBeDefined();
      expect(typeof valueIssue?.message).toBe('string');
      expect(valueIssue?.message.length).toBeGreaterThan(0);
      // Matches the PRD example: { path: 'blocks[0].value', message: 'Expected number, received string' }
      expect(valueIssue?.message.toLowerCase()).toContain('number');
    }
  });
});

describe('validateReport', () => {
  it('returns issues on failure', () => {
    const result = validateReport({ version: '1.0' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
      for (const issue of result.issues) {
        expect(typeof issue.path).toBe('string');
        expect(typeof issue.message).toBe('string');
      }
    }
  });
});
