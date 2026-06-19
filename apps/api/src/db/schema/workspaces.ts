import { pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { serverTimestamp } from './columns.js';
import { memberRole } from './enums.js';
import { users } from './users.js';

/**
 * Workspaces — a single product/project being monitored (PRD "Workspace").
 * One deployment hosts many workspaces; sources are always workspace-bound.
 *
 * `default_dashboard_id` points at the workspace's landing dashboard. It is a
 * nullable plain `text` column (no DB foreign key): `dashboards` already
 * references `workspaces`, so a hard FK back would create a circular
 * constraint. The pointer is maintained in application code and nulled when the
 * referenced dashboard is removed.
 */
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  defaultDashboardId: text('default_dashboard_id'),
  createdAt: serverTimestamp('created_at'),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

/**
 * Workspace membership join with a per-workspace role (PRD RBAC). Composite PK
 * `(workspace_id, user_id)` — a user holds at most one role per workspace.
 * Deleting either the workspace or the user removes the membership.
 */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('viewer'),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;
