import type { DashboardWidget, WidgetSpan } from '@/lib/api-types';
import { WidgetShell } from './widget-shell';
import { WidgetRenderer } from './widget-renderer';
import { SPAN_CLASS, widgetTypeMeta } from './widget-types';
import type { EntityLookup } from './use-entity-lookup';

/**
 * The 12-column responsive grid. Widgets are rendered in the order given (the
 * page sorts saved layouts by `row` then insertion; in edit mode the draft array
 * order is authoritative). Each widget's `span` maps to a column width —
 * full = 12, half = 6, third = 4 — and everything stacks to full width on mobile.
 */
export function DashboardGrid({
  wsId,
  wsSlug,
  widgets,
  lookup,
  editMode,
  onConfigure,
  onRemove,
  onMove,
  onSpanChange,
}: {
  wsId: string;
  wsSlug: string;
  widgets: DashboardWidget[];
  lookup: EntityLookup;
  editMode: boolean;
  onConfigure: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onSpanChange: (id: string, span: WidgetSpan) => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-4">
      {widgets.map((widget, index) => {
        const meta = widgetTypeMeta(widget.type);
        return (
          <div key={widget.id} className={SPAN_CLASS[widget.span]}>
            <WidgetShell
              title={lookup.widgetTitle(widget)}
              icon={meta.icon}
              editMode={editMode}
              span={widget.span}
              onSpanChange={(span) => onSpanChange(widget.id, span)}
              onConfigure={() => onConfigure(widget.id)}
              onRemove={() => onRemove(widget.id)}
              onMoveUp={() => onMove(widget.id, 'up')}
              onMoveDown={() => onMove(widget.id, 'down')}
              canMoveUp={index > 0}
              canMoveDown={index < widgets.length - 1}
            >
              <WidgetRenderer
                wsId={wsId}
                wsSlug={wsSlug}
                widget={widget}
                title={lookup.widgetTitle(widget)}
              />
            </WidgetShell>
          </div>
        );
      })}
    </div>
  );
}
