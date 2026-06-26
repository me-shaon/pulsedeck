import { boolean, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
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
    // 'auto' = name derived from slug at autocreate; 'user' = operator set it.
    // Operator-set names are never overwritten by later agent pushes.
    labelSource: text('label_source', { enum: ['auto', 'user'] })
      .notNull()
      .default('auto'),
    // System-owned category (e.g. the per-workspace "Agent updates" lane). The
    // platform provisions and writes to it; operators can't rename or delete it.
    system: boolean('system').notNull().default(false),
    position: integer('position').notNull().default(0),
  },
  (t) => [uniqueIndex('categories_workspace_slug_uq').on(t.workspaceId, t.slug)],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
