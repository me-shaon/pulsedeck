import { pgTable, text } from 'drizzle-orm/pg-core';
import { serverTimestamp, utcTimestamp } from './columns.js';
import { memberRole } from './enums.js';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

/**
 * Workspace invites (PRD "Members"). An Owner/Admin mints a token-bearing
 * invite for a given role; an authenticated user redeems the token to join the
 * workspace at that role. No email is sent — the token/link is returned to the
 * caller, mirroring the agent invite-token handshake used for sources.
 *
 * `email` is optional: when set, the invite is informational/targeted, but
 * acceptance is gated only by possession of the (random, unguessable) token —
 * we do not require the accepting user's email to match. `accepted_at` marks a
 * single-use token as spent; `expires_at` bounds its lifetime.
 */
export const invites = pgTable('invites', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email'),
  role: memberRole('role').notNull().default('viewer'),
  token: text('token').notNull().unique(),
  expiresAt: utcTimestamp('expires_at').notNull(),
  acceptedAt: utcTimestamp('accepted_at'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: serverTimestamp('created_at'),
});

export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;
