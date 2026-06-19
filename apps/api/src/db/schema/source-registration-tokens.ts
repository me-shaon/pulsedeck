import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { serverTimestamp, utcTimestamp } from './columns.js';
import { sources } from './sources.js';
import { users } from './users.js';

/**
 * One-time source registration tokens (PRD "Registration Handshake").
 *
 * An Owner/Admin creates a Source and is handed a raw `reg_<random>` token
 * exactly once; only its SHA-256 hash is persisted here. An agent redeems the
 * token via `POST /api/v1/sources/register`, which mints the source's `pd_` API
 * key and burns the token. Tokens are:
 *   - single-use: `used_at` is set atomically (CAS on `used_at IS NULL`) the
 *     moment a registration consumes them — no double-registration race.
 *   - short-lived: `expires_at` is 24h after issue.
 *   - hash-only: the raw value is never stored or logged; lookup is by hash.
 *
 * `token_hash` is unique so the hash is the lookup key. Deleting a source (or
 * its workspace) cascades to its tokens.
 */
export const sourceRegistrationTokens = pgTable(
  'source_registration_tokens',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    usedAt: utcTimestamp('used_at'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: serverTimestamp('created_at'),
  },
  // Re-issuing a token invalidates a source's prior unused tokens, so we filter
  // by source_id frequently — index it.
  (t) => [index('source_registration_tokens_source_idx').on(t.sourceId)],
);

export type SourceRegistrationToken = typeof sourceRegistrationTokens.$inferSelect;
export type NewSourceRegistrationToken = typeof sourceRegistrationTokens.$inferInsert;
