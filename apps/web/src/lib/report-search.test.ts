import { describe, expect, it } from 'vitest';
import { filtersToSearch, searchToFilters, validateReportSearch } from './report-search';

/**
 * URL ↔ filter round-trip for the `archived` scope (the archive feature). The
 * default `active` scope must never appear in the URL, while `archived`/`all`
 * round-trip faithfully so an archived view is shareable and back-button safe.
 */
describe('archived scope round-trip', () => {
  it('drops the default "active" scope from the URL', () => {
    expect(validateReportSearch({ archived: 'active' }).archived).toBeUndefined();
    expect(filtersToSearch({ archived: 'active' }).archived).toBeUndefined();
  });

  it('preserves "archived" and "all"', () => {
    expect(validateReportSearch({ archived: 'archived' }).archived).toBe('archived');
    expect(validateReportSearch({ archived: 'all' }).archived).toBe('all');
    expect(filtersToSearch({ archived: 'archived' }).archived).toBe('archived');
    expect(filtersToSearch({ archived: 'all' }).archived).toBe('all');
  });

  it('ignores unknown scope values', () => {
    expect(validateReportSearch({ archived: 'bogus' }).archived).toBeUndefined();
  });

  it('searchToFilters carries the scope through to the API filters', () => {
    expect(searchToFilters({ archived: 'archived' }).archived).toBe('archived');
    expect(searchToFilters({}).archived).toBeUndefined();
  });
});
