import { describe, expect, it } from 'vitest';
import { parseListQuery } from '../src/services/reports-query.js';

/**
 * Pure unit tests for `parseListQuery` — no DB. Focuses on the `archived`
 * tri-state introduced for the archive feature: default scope, accepted values,
 * and strict rejection of unknown values (so a typo can't silently leak archived
 * reports into the default feed).
 */
describe('parseListQuery — archived scope', () => {
  function parse(query: Record<string, unknown>) {
    const res = parseListQuery(query);
    if (!res.ok) throw new Error(`expected ok, got: ${res.message}`);
    return res.value;
  }

  it('defaults to "active" when the param is absent', () => {
    expect(parse({}).archived).toBe('active');
  });

  it('accepts "active", "archived", and "all"', () => {
    expect(parse({ archived: 'active' }).archived).toBe('active');
    expect(parse({ archived: 'archived' }).archived).toBe('archived');
    expect(parse({ archived: 'all' }).archived).toBe('all');
  });

  it('rejects an unknown value with a 400-shaped error (no silent fallback)', () => {
    const res = parseListQuery({ archived: 'bogus' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/archived must be one of/);
  });

  it('leaves the other defaults intact', () => {
    const v = parse({});
    expect(v.q).toBeNull();
    expect(v.severities).toEqual([]);
    expect(v.archived).toBe('active');
  });
});
