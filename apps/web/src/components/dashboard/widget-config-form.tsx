import { useEffect, useState } from 'react';
import type {
  ChartVariant,
  CountBucket,
  CountScope,
  DashboardWidget,
  WidgetRange,
  WidgetSpan,
  WidgetType,
} from '@/lib/api-types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { newWidgetId, SPAN_LABEL, SPAN_ORDER, widgetTypeMeta } from './widget-types';
import type { EntityLookup } from './use-entity-lookup';

/**
 * Add / configure a single widget. Given a `type` (and, when editing, the
 * existing `widget`), it renders the right pickers — stream/category select from
 * the tree, metric-key input, variant/range/bucket/limit/span selects — does
 * client-side required-field validation, and emits a fully-formed, schema-valid
 * widget. The page persists the layout; any API 422 is surfaced there.
 */

interface DraftConfig {
  streamId: string;
  categoryId: string;
  targetId: string;
  metricKey: string;
  label: string;
  variant: ChartVariant;
  range: WidgetRange;
  bucket: CountBucket;
  scope: CountScope;
  limit: number;
}

function initialDraft(widget?: DashboardWidget): DraftConfig {
  const d: DraftConfig = {
    streamId: '',
    categoryId: '',
    targetId: '',
    metricKey: '',
    label: '',
    variant: 'line',
    range: '7d',
    bucket: 'day',
    scope: 'stream',
    limit: 5,
  };
  if (!widget) return d;
  switch (widget.type) {
    case 'stream_feed':
      return { ...d, streamId: widget.config.streamId, limit: widget.config.limit };
    case 'metric':
      return {
        ...d,
        streamId: widget.config.streamId,
        metricKey: widget.config.metricKey,
        label: widget.config.label ?? '',
      };
    case 'chart':
      return {
        ...d,
        streamId: widget.config.streamId,
        metricKey: widget.config.metricKey,
        variant: widget.config.variant,
        range: widget.config.range ?? '7d',
      };
    case 'report_count':
      return {
        ...d,
        scope: widget.config.scope,
        targetId: widget.config.targetId,
        bucket: widget.config.bucket ?? 'day',
        range: widget.config.range ?? '7d',
      };
    case 'alert_feed':
      return { ...d, categoryId: widget.config.categoryId, limit: widget.config.limit };
  }
}

/** Assemble a strict, schema-valid widget from the draft (or null if invalid). */
function buildWidget(
  type: WidgetType,
  draft: DraftConfig,
  base: { id: string; span: WidgetSpan; row: number },
): DashboardWidget | null {
  const limit = Math.max(1, Math.min(20, Math.round(draft.limit) || 1));
  switch (type) {
    case 'stream_feed':
      if (!draft.streamId) return null;
      return { ...base, type, config: { streamId: draft.streamId, limit } };
    case 'metric':
      if (!draft.streamId || !draft.metricKey.trim()) return null;
      return {
        ...base,
        type,
        config: {
          streamId: draft.streamId,
          metricKey: draft.metricKey.trim(),
          ...(draft.label.trim() ? { label: draft.label.trim() } : {}),
        },
      };
    case 'chart':
      if (!draft.streamId || !draft.metricKey.trim()) return null;
      return {
        ...base,
        type,
        config: {
          streamId: draft.streamId,
          metricKey: draft.metricKey.trim(),
          variant: draft.variant,
          range: draft.range,
        },
      };
    case 'report_count':
      if (!draft.targetId) return null;
      return {
        ...base,
        type,
        config: {
          scope: draft.scope,
          targetId: draft.targetId,
          bucket: draft.bucket,
          range: draft.range,
        },
      };
    case 'alert_feed':
      if (!draft.categoryId) return null;
      return { ...base, type, config: { categoryId: draft.categoryId, limit } };
  }
}

const fieldLabel = 'text-xs font-medium text-muted-foreground';

function StreamSelect({
  value,
  onChange,
  lookup,
}: {
  value: string;
  onChange: (id: string) => void;
  lookup: EntityLookup;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger aria-label="Stream">
        <SelectValue placeholder="Select a stream…" />
      </SelectTrigger>
      <SelectContent>
        {lookup.streams.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No streams yet.</div>
        ) : (
          <SelectGroup>
            <SelectLabel>Streams</SelectLabel>
            {lookup.streams.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.categoryName} / {s.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

function CategorySelect({
  value,
  onChange,
  lookup,
}: {
  value: string;
  onChange: (id: string) => void;
  lookup: EntityLookup;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger aria-label="Category">
        <SelectValue placeholder="Select a category…" />
      </SelectTrigger>
      <SelectContent>
        {lookup.categories.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No categories yet.</div>
        ) : (
          lookup.categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

export function WidgetConfigDialog({
  open,
  onOpenChange,
  type,
  widget,
  lookup,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: WidgetType;
  /** The existing widget when editing; undefined when adding. */
  widget?: DashboardWidget;
  lookup: EntityLookup;
  onSubmit: (widget: DashboardWidget) => void;
}) {
  const [draft, setDraft] = useState<DraftConfig>(() => initialDraft(widget));
  const [span, setSpan] = useState<WidgetSpan>(widget?.span ?? 'half');

  // Reset the form whenever the dialog (re)opens for a different widget/type.
  useEffect(() => {
    if (open) {
      setDraft(initialDraft(widget));
      setSpan(widget?.span ?? 'half');
    }
  }, [open, widget, type]);

  const meta = widgetTypeMeta(type);
  const set = <K extends keyof DraftConfig>(key: K, val: DraftConfig[K]) =>
    setDraft((d) => ({ ...d, [key]: val }));

  const built = buildWidget(type, draft, {
    id: widget?.id ?? newWidgetId(),
    span,
    row: widget?.row ?? 0,
  });

  function submit() {
    if (!built) return;
    onSubmit(built);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{widget ? 'Configure widget' : `Add ${meta.label} widget`}</DialogTitle>
          <DialogDescription>{meta.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Stream-backed types */}
          {(type === 'metric' || type === 'chart' || type === 'stream_feed') && (
            <div className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Stream</span>
              <StreamSelect
                value={draft.streamId}
                onChange={(v) => set('streamId', v)}
                lookup={lookup}
              />
            </div>
          )}

          {(type === 'metric' || type === 'chart') && (
            <div className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Metric key</span>
              <Input
                value={draft.metricKey}
                onChange={(e) => set('metricKey', e.target.value)}
                placeholder="e.g. api_latency_p95"
                className="mono"
                aria-label="Metric key"
              />
              <span className="text-[0.6875rem] text-muted-foreground">
                The machine key of the metric (not its display label).
              </span>
            </div>
          )}

          {type === 'metric' && (
            <div className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Label (optional)</span>
              <Input
                value={draft.label}
                onChange={(e) => set('label', e.target.value)}
                placeholder="e.g. Avg API Latency"
                aria-label="Display label"
              />
            </div>
          )}

          {type === 'chart' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <span className={fieldLabel}>Variant</span>
                <Select
                  value={draft.variant}
                  onValueChange={(v) => set('variant', v as ChartVariant)}
                >
                  <SelectTrigger aria-label="Chart variant">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="line">Line</SelectItem>
                    <SelectItem value="bar">Bar</SelectItem>
                    <SelectItem value="area">Area</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <RangeSelect value={draft.range} onChange={(v) => set('range', v)} />
            </div>
          )}

          {/* report_count */}
          {type === 'report_count' && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className={fieldLabel}>Scope</span>
                <Select value={draft.scope} onValueChange={(v) => set('scope', v as CountScope)}>
                  <SelectTrigger aria-label="Scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stream">Stream</SelectItem>
                    <SelectItem value="category">Category</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className={fieldLabel}>
                  {draft.scope === 'category' ? 'Category' : 'Stream'}
                </span>
                {draft.scope === 'category' ? (
                  <CategorySelect
                    value={draft.targetId}
                    onChange={(v) => set('targetId', v)}
                    lookup={lookup}
                  />
                ) : (
                  <StreamSelect
                    value={draft.targetId}
                    onChange={(v) => set('targetId', v)}
                    lookup={lookup}
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className={fieldLabel}>Bucket</span>
                  <Select
                    value={draft.bucket}
                    onValueChange={(v) => set('bucket', v as CountBucket)}
                  >
                    <SelectTrigger aria-label="Bucket">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Per day</SelectItem>
                      <SelectItem value="hour">Per hour</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <RangeSelect value={draft.range} onChange={(v) => set('range', v)} />
              </div>
            </>
          )}

          {/* alert_feed */}
          {type === 'alert_feed' && (
            <div className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Category</span>
              <CategorySelect
                value={draft.categoryId}
                onChange={(v) => set('categoryId', v)}
                lookup={lookup}
              />
            </div>
          )}

          {/* limit for feeds */}
          {(type === 'stream_feed' || type === 'alert_feed') && (
            <div className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Items to show</span>
              <Input
                type="number"
                min={1}
                max={20}
                value={draft.limit}
                onChange={(e) => set('limit', Number(e.target.value))}
                aria-label="Items to show"
                className="w-28"
              />
              <span className="text-[0.6875rem] text-muted-foreground">Between 1 and 20.</span>
            </div>
          )}

          {/* span — applies to every type */}
          <div className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Column span</span>
            <Select value={span} onValueChange={(v) => setSpan(v as WidgetSpan)}>
              <SelectTrigger aria-label="Column span" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPAN_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SPAN_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!built}>
            {widget ? 'Save widget' : 'Add widget'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RangeSelect({
  value,
  onChange,
  className,
}: {
  value: WidgetRange;
  onChange: (v: WidgetRange) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span className={fieldLabel}>Range</span>
      <Select value={value} onValueChange={(v) => onChange(v as WidgetRange)}>
        <SelectTrigger aria-label="Range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="24h">Last 24h</SelectItem>
          <SelectItem value="7d">Last 7 days</SelectItem>
          <SelectItem value="30d">Last 30 days</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
