import type { ArchiveScope } from '@/lib/api-types';
import { cn } from '@/lib/utils';

/**
 * Active / Archived segmented tabs with live counts. Replaces the archive
 * dropdown so the archived report count is always visible (and discoverable).
 * Selecting Active maps the scope back to `undefined` (the default, kept out of
 * the URL); Archived sets `archived`.
 */
export function ScopeTabs({
  scope,
  counts,
  onChange,
}: {
  scope: ArchiveScope;
  counts?: { active: number; archived: number };
  onChange: (scope: ArchiveScope | undefined) => void;
}) {
  const current = scope === 'archived' ? 'archived' : 'active';
  const tabs: { key: 'active' | 'archived'; label: string; count?: number }[] = [
    { key: 'active', label: 'Active', count: counts?.active },
    { key: 'archived', label: 'Archived', count: counts?.archived },
  ];

  return (
    <div
      role="tablist"
      aria-label="Report archive scope"
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1"
    >
      {tabs.map((tab) => {
        const active = current === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key === 'active' ? undefined : 'archived')}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-brand-tint text-brand shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[0.625rem] tabular-nums',
                  active ? 'bg-brand/20 text-brand' : 'bg-surface-2 text-muted-foreground',
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
