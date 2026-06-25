import { useEffect, useRef, useState } from 'react';
import { Calendar, X } from 'lucide-react';
import { endOfDay, format, startOfDay, subDays, startOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

export interface DateRangeValue {
  from?: string;
  to?: string;
}

/**
 * Single date-range control replacing the separate From/To inputs. A trigger
 * shows the active range; the panel offers quick presets plus custom From/To
 * fields and a clear. Self-contained (no Popover dep): an absolutely-positioned
 * panel that closes on outside click / Esc, matching the MultiSelect pattern.
 *
 * Boundaries are stored as ISO instants — `from` at the start of its day, `to`
 * at the end — so the inclusive range matches what the API expects.
 */
export function DateRangeField({
  value,
  onChange,
  ariaLabel = 'Filter by date range',
}: {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const hasValue = Boolean(value.from || value.to);

  function setFrom(date: string) {
    onChange({ ...value, from: date ? `${date}T00:00:00Z` : undefined });
  }
  function setTo(date: string) {
    onChange({ ...value, to: date ? `${date}T23:59:59Z` : undefined });
  }
  function preset(days: number) {
    const now = new Date();
    onChange({
      from: startOfDay(subDays(now, days - 1)).toISOString(),
      to: endOfDay(now).toISOString(),
    });
    setOpen(false);
  }
  function presetThisMonth() {
    const now = new Date();
    onChange({ from: startOfMonth(now).toISOString(), to: endOfDay(now).toISOString() });
    setOpen(false);
  }
  function clear() {
    onChange({ from: undefined, to: undefined });
  }

  const label = (() => {
    const f = value.from ? format(new Date(value.from), 'd MMM') : null;
    const t = value.to ? format(new Date(value.to), 'd MMM') : null;
    if (f && t) return `${f} – ${t}`;
    if (f) return `From ${f}`;
    if (t) return `Until ${t}`;
    return 'Any date';
  })();

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-xs transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          hasValue ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <span className="inline-flex items-center gap-1.5 truncate">
          <Calendar className="size-3.5 shrink-0" aria-hidden />
          {label}
        </span>
        {hasValue ? (
          <X
            className="size-3.5 shrink-0 text-muted-foreground hover:text-foreground"
            aria-hidden
            onClick={(e) => {
              e.stopPropagation();
              clear();
            }}
          />
        ) : null}
      </button>

      {open ? (
        <div className="absolute z-20 mt-1 w-64 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: 'Last 7 days', run: () => preset(7) },
              { label: 'Last 30 days', run: () => preset(30) },
              { label: 'Last 90 days', run: () => preset(90) },
              { label: 'This month', run: presetThisMonth },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={p.run}
                className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">
                From
              </span>
              <Input
                type="date"
                value={value.from ? value.from.slice(0, 10) : ''}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="From date"
                className="h-8"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">
                To
              </span>
              <Input
                type="date"
                value={value.to ? value.to.slice(0, 10) : ''}
                onChange={(e) => setTo(e.target.value)}
                aria-label="To date"
                className="h-8"
              />
            </label>
          </div>

          {hasValue ? (
            <button
              type="button"
              onClick={clear}
              className="mt-3 w-full rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              Clear dates
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
