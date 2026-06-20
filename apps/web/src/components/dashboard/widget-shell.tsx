import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WidgetSpan } from '@/lib/api-types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SPAN_LABEL, SPAN_ORDER } from './widget-types';
import { WidgetErrorBoundary } from './widget-error-boundary';

/**
 * The Card frame around every widget: a title row (with the type icon) and, in
 * edit mode, the per-widget controls — configure, set column span, reorder
 * (up/down), remove. The body is wrapped in a {@link WidgetErrorBoundary} so a
 * render crash in one widget shows an inline notice instead of blanking the grid.
 */
export interface WidgetShellProps {
  title: string;
  icon: LucideIcon;
  editMode: boolean;
  span: WidgetSpan;
  onSpanChange: (span: WidgetSpan) => void;
  onConfigure: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  children: ReactNode;
}

export function WidgetShell({
  title,
  icon: Icon,
  editMode,
  span,
  onSpanChange,
  onConfigure,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  children,
}: WidgetShellProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{title}</span>
        </CardTitle>

        {editMode ? (
          <div className="flex shrink-0 items-center gap-1">
            <Select value={span} onValueChange={(v) => onSpanChange(v as WidgetSpan)}>
              <SelectTrigger
                className="h-7 w-24 text-xs"
                aria-label="Column span"
                title="Column span"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPAN_ORDER.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {SPAN_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Move widget up"
              disabled={!canMoveUp}
              onClick={onMoveUp}
            >
              <ChevronUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Move widget down"
              disabled={!canMoveDown}
              onClick={onMoveDown}
            >
              <ChevronDown className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Configure widget"
              onClick={onConfigure}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              aria-label="Remove widget"
              onClick={onRemove}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="min-w-0 flex-1">
        <WidgetErrorBoundary>{children}</WidgetErrorBoundary>
      </CardContent>
    </Card>
  );
}
