import type { Severity } from '@pulsedeck/schema';
import type { ArchiveScope, ReportFilters } from './api-types';

/**
 * URL search-param schema for the report list + search routes. Filters live in
 * the URL so a filtered/searched view is shareable and back-button friendly.
 * `tags` is kept as a comma string in the URL (clean) and exploded into an
 * array for the API.
 */
export interface ReportSearch {
  q?: string;
  /** Comma-joined severities in the URL (e.g. `warning,critical`); ANY semantics. */
  severity?: string;
  source?: string;
  category?: string;
  stream?: string;
  from?: string;
  to?: string;
  tags?: string;
  /** Archive scope; absent = the default `active` feed. */
  archived?: ArchiveScope;
}

const SEVERITIES: ReadonlyArray<Severity> = ['info', 'warning', 'critical'];
const ARCHIVE_SCOPES: ReadonlyArray<ArchiveScope> = ['active', 'archived', 'all'];

/** Coerce a raw param into an ArchiveScope; `active` (the default) maps to undefined. */
function parseArchived(raw: unknown): ArchiveScope | undefined {
  const v = typeof raw === 'string' ? raw : undefined;
  return v && v !== 'active' && ARCHIVE_SCOPES.includes(v as ArchiveScope)
    ? (v as ArchiveScope)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Explode a comma/repeated raw value into a clean, deduped severity list. */
function parseSeverities(raw: unknown): Severity[] {
  const parts = (Array.isArray(raw) ? raw : [raw])
    .filter((v): v is string => typeof v === 'string')
    .flatMap((v) => v.split(','))
    .map((s) => s.trim());
  const out: Severity[] = [];
  for (const p of parts) {
    if (SEVERITIES.includes(p as Severity) && !out.includes(p as Severity)) out.push(p as Severity);
  }
  return out;
}

/** Router `validateSearch`: coerces raw params into a typed, clean shape. */
export function validateReportSearch(raw: Record<string, unknown>): ReportSearch {
  const severities = parseSeverities(raw.severity);
  return {
    q: str(raw.q),
    severity: severities.length ? severities.join(',') : undefined,
    source: str(raw.source),
    category: str(raw.category),
    stream: str(raw.stream),
    from: str(raw.from),
    to: str(raw.to),
    tags: str(raw.tags),
    archived: parseArchived(raw.archived),
  };
}

/** URL search → API filters (explode tags). */
export function searchToFilters(search: ReportSearch): ReportFilters {
  return {
    q: search.q,
    severity: search.severity ? parseSeverities(search.severity) : undefined,
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
    archived: search.archived,
  };
}

/** API filters → URL search (join tags, drop empties). */
export function filtersToSearch(filters: ReportFilters): ReportSearch {
  return {
    q: filters.q || undefined,
    severity: filters.severity && filters.severity.length ? filters.severity.join(',') : undefined,
    source: filters.source || undefined,
    category: filters.category || undefined,
    stream: filters.stream || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    tags: filters.tags && filters.tags.length ? filters.tags.join(',') : undefined,
    archived: filters.archived && filters.archived !== 'active' ? filters.archived : undefined,
  };
}
