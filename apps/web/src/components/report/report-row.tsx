import { Link } from '@tanstack/react-router';
import { Layers } from 'lucide-react';
import type { ReportSummary } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Mono } from '@/components/ui/mono';
import { RelativeTime } from '@/components/common/relative-time';
import { severityVariant, titleCase } from '@/lib/domain';
import { cn } from '@/lib/utils';

/**
 * A single report in a feed. The whole card links to the permalink. When
 * `selectable` is set (the user may archive/delete), a checkbox sits to the left
 * of the card — outside the `Link` so toggling never navigates.
 *
 * The checkbox is only painted when selection is engaged: it reveals on row
 * hover (desktop accelerator) and on keyboard focus, and is shown for every row
 * once `selectionActive` (the user entered selection mode or selected a row).
 * Its narrow gutter is always reserved so revealing it never shifts the layout.
 */
export function ReportRow({
  ws,
  report,
  selectable = false,
  selected = false,
  selectionActive = false,
  onToggleSelect,
}: {
  ws: string;
  report: ReportSummary;
  selectable?: boolean;
  selected?: boolean;
  /** When true, every row's checkbox is painted (selection mode / a row is selected). */
  selectionActive?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const card = (
    <Link
      to="/w/$ws/r/$reportId"
      params={{ ws, reportId: report.id }}
      className="group flex flex-1 flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3.5 transition-colors hover:border-border-strong hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground group-hover:text-foreground">
          {report.title}
        </h3>
        {report.severity ? (
          <Badge variant={severityVariant(report.severity)} dot className="shrink-0">
            {titleCase(report.severity)}
          </Badge>
        ) : null}
      </div>

      {report.summary ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {report.summary}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="font-medium text-foreground/80">{report.category.name}</span>
          <span aria-hidden>/</span>
          <span>{report.stream.name}</span>
        </span>
        <span aria-hidden>·</span>
        <Mono className="text-[0.6875rem]" title={`source ${report.source.id}`}>
          {report.source.name}
        </Mono>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <Layers className="size-3" aria-hidden /> {report.blockCount}
        </span>
        <span aria-hidden>·</span>
        <RelativeTime value={report.occurredAt} />
        {report.tags.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1">
            {report.tags.slice(0, 4).map((tag) => (
              <Badge key={tag} variant="outline" className="px-1.5 py-0 text-[0.625rem]">
                {tag}
              </Badge>
            ))}
            {report.tags.length > 4 ? <span>+{report.tags.length - 4}</span> : null}
          </span>
        ) : null}
      </div>
    </Link>
  );

  if (!selectable) return card;

  return (
    <div className="group/row flex items-stretch gap-2">
      <label
        className={cn(
          'flex w-5 shrink-0 cursor-pointer items-center justify-center transition-opacity',
          selectionActive || selected
            ? 'opacity-100'
            : 'opacity-0 focus-within:opacity-100 group-hover/row:opacity-100',
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect?.(report.id)}
          className="size-4 cursor-pointer rounded border-border accent-primary"
          aria-label={`Select report: ${report.title}`}
        />
      </label>
      {card}
    </div>
  );
}
