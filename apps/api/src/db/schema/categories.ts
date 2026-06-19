import { integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';

/**
 * Categories — top-level grouping within a workspace (PRD "Categories").
 * `slug` is unique within a workspace (not globally). Deleting a workspace
 * cascades to its categories (and onward to streams and reports).
 */
export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [uniqueIndex('categories_workspace_slug_uq').on(t.workspaceId, t.slug)],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
