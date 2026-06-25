import { Link } from '@tanstack/react-router';
import { Layers } from 'lucide-react';
import type { ReportSummary } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Mono } from '@/components/ui/mono';
import { RelativeTime } from '@/components/common/relative-time';
import { severityVariant, titleCase } from '@/lib/domain';

/**
 * A single report in a feed. The whole card links to the permalink. When
 * `selectable` is set (bulk archive/delete mode), a checkbox is rendered to the
 * left of the card — outside the `Link` so toggling never triggers navigation.
 */
export function ReportRow({
  ws,
  report,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  ws: string;
  report: ReportSummary;
  selectable?: boolean;
  selected?: boolean;
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
    <div className="flex items-stretch gap-2.5">
      <label className="flex shrink-0 items-center pl-1">
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
