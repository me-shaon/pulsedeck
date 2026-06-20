import type { Severity } from '@pulsedeck/schema';
import type { ReportFilters } from './api-types';

/**
 * URL search-param schema for the report list + search routes. Filters live in
 * the URL so a filtered/searched view is shareable and back-button friendly.
 * `tags` is kept as a comma string in the URL (clean) and exploded into an
 * array for the API.
 */
export interface ReportSearch {
  q?: string;
  severity?: Severity;
  source?: string;
  category?: string;
  stream?: string;
  from?: string;
  to?: string;
  tags?: string;
}

const SEVERITIES: ReadonlyArray<Severity> = ['info', 'warning', 'critical'];

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Router `validateSearch`: coerces raw params into a typed, clean shape. */
export function validateReportSearch(raw: Record<string, unknown>): ReportSearch {
  const severity = str(raw.severity);
  return {
    q: str(raw.q),
    severity:
      severity && SEVERITIES.includes(severity as Severity) ? (severity as Severity) : undefined,
    source: str(raw.source),
    category: str(raw.category),
    stream: str(raw.stream),
    from: str(raw.from),
    to: str(raw.to),
    tags: str(raw.tags),
  };
}

/** URL search → API filters (explode tags). */
export function searchToFilters(search: ReportSearch): ReportFilters {
  return {
    q: search.q,
    severity: search.severity,
    source: search.source,
    category: search.category,
    stream: search.stream,
    from: search.from,
    to: search.to,
    tags: search.tags
      ? search.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined,
  };
}

/** API filters → URL search (join tags, drop empties). */
export function filtersToSearch(filters: ReportFilters): ReportSearch {
  return {
    q: filters.q || undefined,
    severity: filters.severity,
    source: filters.source || undefined,
    category: filters.category || undefined,
    stream: filters.stream || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    tags: filters.tags && filters.tags.length ? filters.tags.join(',') : undefined,
  };
}
