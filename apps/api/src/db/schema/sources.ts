import { boolean, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { serverTimestamp, utcTimestamp } from './columns.js';
import { sourceScope } from './enums.js';
import { categories } from './categories.js';
import { streams } from './streams.js';
import { workspaces } from './workspaces.js';

/**
 * Sources — external agents/systems that push reports into a workspace
 * (PRD "Sources" + "Source Write Scope"). Registered via an invite-token
 * handshake; the issued API key is stored only as a hash.
 *
 *  - `api_key_hash` is nullable: a source row exists from the moment an admin
 *    creates it (with a pending registration token) but has no key hash until
 *    the agent completes the handshake. Key rotation/revocation updates or
 *    nulls this column.
 *  - `scope` defaults to `workspace` (may write to any category/stream in its
 *    own workspace). `category`/`stream` narrow the blast radius via the join
 *    tables below.
 *  - `allow_stream_autocreate` (default true) lets a push create an unknown
 *    stream; when false such a push returns 409.
 *
 * Deleting a workspace cascades to its sources.
 */
export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  apiKeyHash: text('api_key_hash'),
  agentVersion: text('agent_version'),
  scope: sourceScope('scope').notNull().default('workspace'),
  allowStreamAutocreate: boolean('allow_stream_autocreate').notNull().default(true),
  lastSeenAt: utcTimestamp('last_seen_at'),
  createdAt: serverTimestamp('created_at'),
});

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

/**
 * Source → category grants. Consulted only when `sources.scope = 'category'`.
 * Composite PK; deleting either side removes the grant.
 */
export const sourceCategories = pgTable(
  'source_categories',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.categoryId] })],
);

export type SourceCategory = typeof sourceCategories.$inferSelect;
export type NewSourceCategory = typeof sourceCategories.$inferInsert;

/**
 * Source → stream grants. Consulted only when `sources.scope = 'stream'`.
 * Composite PK; deleting either side removes the grant.
 */
export const sourceStreams = pgTable(
  'source_streams',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    streamId: text('stream_id')
      .notNull()
      .references(() => streams.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.streamId] })],
);

export type SourceStream = typeof sourceStreams.$inferSelect;
export type NewSourceStream = typeof sourceStreams.$inferInsert;
