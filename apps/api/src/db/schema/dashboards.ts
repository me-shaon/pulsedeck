import { sql } from 'drizzle-orm';
import { boolean, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { serverTimestamp } from './columns.js';
import { workspaces } from './workspaces.js';

/**
 * A single widget placed on a dashboard's 12-column grid (PRD "Dashboards &
 * Navigation"). Kept intentionally loose at the DB layer — the widget config
 * contract is validated/rendered in later phases. Stored inside `layout`.
 */
export interface DashboardWidget {
  id: string;
  type: 'stream_feed' | 'metric' | 'chart' | 'report_count' | 'alert_feed';
  /** Column span on the 12-col grid (e.g. 12 = full, 6 = half, 4 = third). */
  span: number;
  /** Widget-specific configuration (source stream/category, metric key, etc.). */
  config: Record<string, unknown>;
}

/**
 * Dashboards — user-curated grid pages within a workspace. One per workspace is
 * marked `is_default` and is the landing view. `position` orders them in the
 * sidebar. `slug` is unique within a workspace. Deleting a workspace cascades
 * to its dashboards.
 */
export const dashboards = pgTable(
  'dashboards',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    icon: text('icon'),
    position: integer('position').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    layout: jsonb('layout')
      .$type<DashboardWidget[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: serverTimestamp('created_at'),
  },
  (t) => [uniqueIndex('dashboards_workspace_slug_uq').on(t.workspaceId, t.slug)],
);

export type Dashboard = typeof dashboards.$inferSelect;
export type NewDashboard = typeof dashboards.$inferInsert;
