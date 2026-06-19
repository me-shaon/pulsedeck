import { describe, it, expect } from 'vitest';
import {
  severitySchema,
  statusSchema,
  trendSchema,
  sentimentSchema,
  formatSchema,
  chartVariantSchema,
  columnTypeSchema,
} from '../src/index.js';

describe('canonical enums', () => {
  it('accept their documented values', () => {
    expect(severitySchema.parse('critical')).toBe('critical');
    expect(statusSchema.parse('degraded')).toBe('degraded');
    expect(trendSchema.parse('flat')).toBe('flat');
    expect(sentimentSchema.parse('positive')).toBe('positive');
    expect(formatSchema.parse('currency')).toBe('currency');
    expect(chartVariantSchema.parse('area')).toBe('area');
    expect(columnTypeSchema.parse('date')).toBe('date');
  });

  it('reject unknown values', () => {
    expect(severitySchema.safeParse('fatal').success).toBe(false);
    expect(statusSchema.safeParse('on-fire').success).toBe(false);
    expect(trendSchema.safeParse('sideways').success).toBe(false);
    expect(sentimentSchema.safeParse('happy').success).toBe(false);
    expect(formatSchema.safeParse('scientific').success).toBe(false);
    expect(chartVariantSchema.safeParse('pie').success).toBe(false);
    expect(columnTypeSchema.safeParse('boolean').success).toBe(false);
  });
});
