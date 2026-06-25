import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import type { Severity } from '@pulsedeck/schema';
import type { ReportFilters, Source, Tree } from '@/lib/api-types';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DateRangeField } from '@/components/ui/date-range';
import { MultiSelect } from '@/components/ui/multi-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDebounced } from '@/hooks/use-debounce';

/**
 * Search box + filter controls that drive the report list query. The owning
 * page keeps these in the URL (shareable / back-button friendly); this
 * component is fully controlled. The search box is debounced so typing doesn't
 * spam the query (and the URL).
 */

const ALL = '__all__';
const SEVERITIES: Severity[] = ['info', 'warning', 'critical'];

export function ReportFiltersBar({
  filters,
  onChange,
  sources,
  tree,
  tags,
  hideStreamFilter = false,
}: {
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
  sources?: Source[];
  tree?: Tree;
  /** Distinct workspace tags — options for the tag multi-select. */
  tags?: string[];
  /** Hide category/stream selects when already scoped to a stream feed. */
  hideStreamFilter?: boolean;
}) {
  // Local, debounced search text so the URL only updates after a pause.
  const [q, setQ] = useState(filters.q ?? '');
  const debouncedQ = useDebounced(q, 350);

  // Keep local in sync if filters are reset/changed externally (e.g. Clear).
  useEffect(() => {
    setQ(filters.q ?? '');
  }, [filters.q]);

  const emitQ = useRef(onChange);
  emitQ.current = onChange;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  useEffect(() => {
    const current = filtersRef.current;
    if ((current.q ?? '') !== debouncedQ) {
      emitQ.current({ ...current, q: debouncedQ || undefined });
    }
  }, [debouncedQ]);

  const streams = useMemo(() => {
    if (!tree) return [];
    const cats = filters.category
      ? tree.categories.filter((c) => c.slug === filters.category || c.id === filters.category)
      : tree.categories;
    return cats.flatMap((c) => c.streams);
  }, [tree, filters.category]);

  const hasActive = Boolean(
    filters.q ||
    (filters.severity && filters.severity.length > 0) ||
    filters.source ||
    filters.category ||
    filters.stream ||
    filters.from ||
    filters.to ||
    (filters.tags && filters.tags.length > 0) ||
    (filters.archived && filters.archived !== 'active'),
  );

  function set<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    onChange({ ...filters, [key]: value } as ReportFilters);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reports…"
            aria-label="Search reports"
            className="pl-8"
          />
        </div>
        {hasActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({})}
            className="shrink-0 text-muted-foreground"
          >
            <X className="size-3.5" /> Clear
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <FilterField label="Severity">
          <div className="flex items-center gap-1" role="group" aria-label="Filter by severity">
            {SEVERITIES.map((s) => {
              const active = (filters.severity ?? []).includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    const cur = filters.severity ?? [];
                    const next = active ? cur.filter((x) => x !== s) : [...cur, s];
                    set('severity', next.length ? next : undefined);
                  }}
                  className={cn(
                    'flex h-8 items-center rounded-md border px-2.5 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'border-brand bg-brand-tint text-brand'
                      : 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground',
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </FilterField>

        {sources && sources.length > 0 ? (
          <FilterField label="Source">
            <Select
              value={filters.source ?? ALL}
              onValueChange={(v) => set('source', v === ALL ? undefined : v)}
            >
              <SelectTrigger className="w-40" aria-label="Filter by source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sources</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        ) : null}

        {!hideStreamFilter && tree ? (
          <>
            <FilterField label="Category">
              <Select
                value={filters.category ?? ALL}
                onValueChange={(v) =>
                  onChange({
                    ...filters,
                    category: v === ALL ? undefined : v,
                    stream: undefined,
                  })
                }
              >
                <SelectTrigger className="w-40" aria-label="Filter by category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All categories</SelectItem>
                  {tree.categories.map((c) => (
                    <SelectItem key={c.id} value={c.slug}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Stream">
              <Select
                value={filters.stream ?? ALL}
                onValueChange={(v) => set('stream', v === ALL ? undefined : v)}
              >
                <SelectTrigger className="w-40" aria-label="Filter by stream">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All streams</SelectItem>
                  {streams.map((s) => (
                    <SelectItem key={s.id} value={s.slug}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </>
        ) : null}

        <FilterField label="Date">
          <DateRangeField
            value={{ from: filters.from, to: filters.to }}
            onChange={(range) => onChange({ ...filters, from: range.from, to: range.to })}
          />
        </FilterField>

        <FilterField label="Tags">
          <div className="w-44">
            <MultiSelect
              options={(tags ?? []).map((t) => ({ value: t, label: t }))}
              value={filters.tags ?? []}
              onChange={(next) => set('tags', next.length ? next : undefined)}
              ariaLabel="Filter by tags"
              placeholder="Search tags…"
              emptyLabel="All tags"
            />
          </div>
        </FilterField>
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
