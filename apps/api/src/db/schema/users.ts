import { boolean, pgTable, text } from 'drizzle-orm/pg-core';
import { serverTimestamp } from './columns.js';

/**
 * Users — a better-auth-compatible base table.
 *
 * Phase 3 introduces authentication via **better-auth** (email/password +
 * GitHub OAuth). better-auth owns credentials and sessions in its OWN tables
 * (`account`, `session`, `verification`), which Phase 3 will add. Consequently:
 *
 *  - There is intentionally NO `password_hash` column here. The PRD Data Model
 *    lists one on `users`, but better-auth supersedes that: password hashes
 *    live in better-auth's `account` table (added in Phase 3), not here.
 *  - Session/account/verification tables are NOT created now — that is Phase 3.
 *
 * The columns below (`id`, `email`, `name`, `email_verified`, `image`,
 * timestamps) are exactly the fields better-auth expects on its core user
 * model, so wiring it up in Phase 3 requires no migration churn.
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: serverTimestamp('created_at'),
  updatedAt: serverTimestamp('updated_at'),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
