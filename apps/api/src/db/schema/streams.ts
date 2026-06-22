import { integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { categories } from './categories.js';

/**
 * Streams — continuous report feeds inside a category (PRD "Streams").
 * `slug` is unique within its category. Deleting a category cascades to its
 * streams (and onward to their reports).
 */
export const streams = pgTable(
  'streams',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    // 'auto' = name derived from slug at autocreate; 'user' = operator set it.
    // Operator-set names are never overwritten by later agent pushes.
    labelSource: text('label_source', { enum: ['auto', 'user'] })
      .notNull()
      .default('auto'),
    position: integer('position').notNull().default(0),
  },
  (t) => [uniqueIndex('streams_category_slug_uq').on(t.categoryId, t.slug)],
);

export type Stream = typeof streams.$inferSelect;
export type NewStream = typeof streams.$inferInsert;
