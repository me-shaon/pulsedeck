import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Clock, Inbox } from 'lucide-react';
import type { ReportDetail } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Mono } from '@/components/ui/mono';
import { RelativeTime } from '@/components/common/relative-time';
import { absoluteTime } from '@/lib/time';
import { severityVariant, titleCase } from '@/lib/domain';

/** Report detail metadata header: identity, severity, lineage, timing, tags. */
export function ReportMetaHeader({
  ws,
  report,
  actions,
}: {
  ws: string;
  report: ReportDetail;
  /** Optional action cluster (archive/delete), aligned right of the breadcrumb. */
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-border pb-5">
      <div className="flex items-center justify-between gap-3">
        <nav className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Link
            to="/w/$ws/reports"
            params={{ ws }}
            className="truncate hover:text-foreground hover:underline"
          >
            {report.category.name}
          </Link>
          <span aria-hidden>/</span>
          <Link
            to="/w/$ws/stream/$streamId"
            params={{ ws, streamId: report.stream.id }}
            className="truncate hover:text-foreground hover:underline"
          >
            {report.stream.name}
          </Link>
        </nav>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>

      <div className="flex items-start justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {report.title}
        </h1>
        {report.severity ? (
          <Badge variant={severityVariant(report.severity)} dot className="mt-1 shrink-0">
            {titleCase(report.severity)}
          </Badge>
        ) : null}
      </div>

      {report.summary ? (
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{report.summary}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          Source{' '}
          <Mono className="text-[0.6875rem]" title={report.source.id}>
            {report.source.name}
          </Mono>
        </span>
        <span className="inline-flex items-center gap-1.5" title={absoluteTime(report.occurredAt)}>
          <Clock className="size-3.5" aria-hidden /> Occurred{' '}
          <RelativeTime value={report.occurredAt} />
        </span>
        <span className="inline-flex items-center gap-1.5" title={absoluteTime(report.receivedAt)}>
          <Inbox className="size-3.5" aria-hidden /> Received{' '}
          <RelativeTime value={report.receivedAt} />
        </span>
      </div>

      {report.tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {report.tags.map((tag) => (
            <Badge key={tag} variant="neutral">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
    </header>
  );
}

/** Prev/next navigation within the stream (newest-first ordering). */
export function PrevNextNav({
  ws,
  prevReportId,
  nextReportId,
}: {
  ws: string;
  prevReportId: string | null;
  nextReportId: string | null;
}) {
  return (
    <nav aria-label="Report navigation" className="flex items-center justify-between gap-2">
      {prevReportId ? (
        <Button asChild variant="outline" size="sm">
          <Link to="/w/$ws/r/$reportId" params={{ ws, reportId: prevReportId }}>
            <ChevronLeft className="size-3.5" /> Newer
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          <ChevronLeft className="size-3.5" /> Newer
        </Button>
      )}
      {nextReportId ? (
        <Button asChild variant="outline" size="sm">
          <Link to="/w/$ws/r/$reportId" params={{ ws, reportId: nextReportId }}>
            Older <ChevronRight className="size-3.5" />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          Older <ChevronRight className="size-3.5" />
        </Button>
      )}
    </nav>
  );
}
