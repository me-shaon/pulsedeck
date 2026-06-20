import { useMemo } from 'react';
import { useTree } from '@/hooks/use-workspace-data';
import type { DashboardWidget } from '@/lib/api-types';
import { widgetTargetId, widgetTypeMeta } from './widget-types';

export interface StreamOption {
  id: string;
  name: string;
  categoryName: string;
}
export interface CategoryOption {
  id: string;
  name: string;
}

export interface EntityLookup {
  streams: StreamOption[];
  categories: CategoryOption[];
  streamName: (id: string) => string | undefined;
  categoryName: (id: string) => string | undefined;
  /** A human title for a widget: its label/target name, falling back to the type. */
  widgetTitle: (widget: DashboardWidget) => string;
  isPending: boolean;
}

/**
 * Resolve workspace stream/category names from the cached `/tree` so widget
 * titles and the config pickers read the same human names the sidebar uses.
 * Never throws on a missing id (a widget may point at a since-deleted stream) —
 * `streamName`/`categoryName` simply return undefined and the caller degrades.
 */
export function useEntityLookup(wsId: string): EntityLookup {
  const tree = useTree(wsId);

  return useMemo(() => {
    const streams: StreamOption[] = [];
    const categories: CategoryOption[] = [];
    const streamMap = new Map<string, string>();
    const categoryMap = new Map<string, string>();

    for (const category of tree.data?.categories ?? []) {
      categories.push({ id: category.id, name: category.name });
      categoryMap.set(category.id, category.name);
      for (const stream of category.streams) {
        streams.push({ id: stream.id, name: stream.name, categoryName: category.name });
        streamMap.set(stream.id, stream.name);
      }
    }

    const streamName = (id: string) => streamMap.get(id);
    const categoryName = (id: string) => categoryMap.get(id);

    const widgetTitle = (widget: DashboardWidget): string => {
      if (widget.type === 'metric' && widget.config.label) return widget.config.label;
      const targetId = widgetTargetId(widget);
      const name =
        widget.type === 'alert_feed' ||
        (widget.type === 'report_count' && widget.config.scope === 'category')
          ? categoryName(targetId)
          : streamName(targetId);
      const meta = widgetTypeMeta(widget.type);
      if (!name) return meta.label;
      if (widget.type === 'metric') return widget.config.metricKey;
      if (widget.type === 'chart') return `${name} · ${widget.config.metricKey}`;
      return name;
    };

    return {
      streams,
      categories,
      streamName,
      categoryName,
      widgetTitle,
      isPending: tree.isPending,
    };
  }, [tree.data, tree.isPending]);
}
