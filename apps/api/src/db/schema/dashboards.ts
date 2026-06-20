import { sql } from 'drizzle-orm';
import { boolean, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import type { DashboardLayout } from '../../dashboards/layout-schema.js';
import { serverTimestamp } from './columns.js';
import { workspaces } from './workspaces.js';

/**
 * The widget-grid `layout` contract (the versioned `{ version, widgets[] }`
 * envelope) is defined and validated in `src/dashboards/layout-schema.ts`. The
 * column is typed with the inferred {@link DashboardLayout} here (a type-only
 * import, so the DB schema stays runtime-decoupled from app code and drizzle-kit
 * is unaffected). Reads normalize legacy/bare values via `normalizeLayout`.
 */

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
      .$type<DashboardLayout>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: serverTimestamp('created_at'),
  },
  (t) => [uniqueIndex('dashboards_workspace_slug_uq').on(t.workspaceId, t.slug)],
);

export type Dashboard = typeof dashboards.$inferSelect;
export type NewDashboard = typeof dashboards.$inferInsert;
