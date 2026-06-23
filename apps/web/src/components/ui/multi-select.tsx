import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Searchable multi-select dropdown. Self-contained (no Popover dep): a trigger
 * styled like the Select, plus an absolutely-positioned panel with a search box
 * and a scrollable, checkable option list. Empty selection renders the
 * `emptyLabel` (used as the "matches all" hint). Closes on outside click / Esc.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  emptyLabel = 'Any',
  ariaLabel,
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = useMemo(() => new Set(value), [value]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const summary = useMemo(() => {
    if (value.length === 0) return null;
    return options
      .filter((o) => selected.has(o.value))
      .map((o) => o.label)
      .join(', ');
  }, [options, selected, value.length]);

  function toggle(v: string) {
    onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm',
          'transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <span
          className={cn('min-w-0 flex-1 truncate text-left', !summary && 'text-muted-foreground')}
        >
          {summary ?? emptyLabel}
        </span>
        {value.length > 0 ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear selection"
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </span>
        ) : null}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {open ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-md">
          <div className="flex items-center gap-2 border-b border-border px-2.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul
            role="listbox"
            aria-label={ariaLabel}
            id={listId}
            className="max-h-56 overflow-auto p-1"
          >
            {filtered.length === 0 ? (
              <li className="px-2 py-2 text-xs text-muted-foreground">No matches</li>
            ) : (
              filtered.map((o) => {
                const on = selected.has(o.value);
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => toggle(o.value)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2',
                        on && 'font-medium',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border',
                          on ? 'border-brand bg-brand text-white' : 'border-border-strong',
                        )}
                      >
                        {on ? <Check className="size-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
