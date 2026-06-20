import type { Status, TimelineBlock as TimelineBlockT } from '@pulsedeck/schema';
import { cn } from '@/lib/utils';
import { STATUS_DOT, titleCase } from '@/lib/domain';
import { absoluteTime, relativeTime } from '@/lib/time';
import { BlockFrame } from './block-frame';

/** timeline — ordered events with time / label / description / optional status. */
export function TimelineBlock({ block }: { block: TimelineBlockT }) {
  return (
    <BlockFrame title={block.title} caption={block.caption}>
      <ol className="relative ml-1.5 flex flex-col gap-4 border-l border-border pl-5">
        {block.events.map((event, i) => {
          const status = event.status as Status | undefined;
          return (
            <li key={i} className="relative">
              <span
                aria-hidden
                className={cn(
                  'absolute -left-[1.4rem] top-1 size-2.5 rounded-full ring-2 ring-surface',
                  status ? (STATUS_DOT[status] ?? 'bg-status-unknown') : 'bg-border-strong',
                )}
              />
              <div className="flex flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium text-foreground">{event.label}</span>
                  <time
                    dateTime={event.time}
                    title={absoluteTime(event.time)}
                    className="mono text-[0.6875rem] text-muted-foreground"
                  >
                    {relativeTime(event.time)}
                  </time>
                  {status ? (
                    <span className="text-[0.6875rem] text-muted-foreground">
                      · {titleCase(status)}
                    </span>
                  ) : null}
                </div>
                {event.description ? (
                  <p className="text-xs text-muted-foreground">{event.description}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </BlockFrame>
  );
}
