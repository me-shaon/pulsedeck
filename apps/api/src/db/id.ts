import { nanoid } from 'nanoid';

/**
 * Prefixed-id generation for PulseDeck primary keys.
 *
 * Primary keys are `text` columns holding a short, human-greppable, prefixed id
 * (e.g. `src_V1StGXR8_Z5jdHi6B`). Ids are generated in application code at
 * insert time — there is no DB-side default — so a row's identity is known
 * before it hits the database (handy for idempotent ingest and SSE fan-out).
 */

/** Entity → id prefix. Keep prefixes short, lowercase, and collision-free. */
export const ID_PREFIXES = {
  workspace: 'ws',
  user: 'usr',
  source: 'src',
  category: 'cat',
  stream: 'stm',
  report: 'rpt',
  dashboard: 'dsh',
  reportMetric: 'mtr',
  invite: 'inv',
} as const;

/** Union of every valid id prefix (`'ws' | 'usr' | ...`). */
export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/** Length of the random component appended after the prefix. */
const RANDOM_SIZE = 21;

/**
 * Generate a prefixed id, e.g. `id('src')` → `src_V1StGXR8_Z5jdHi6Buw`.
 *
 * The prefix is constrained to {@link IdPrefix} so typos are caught at compile
 * time. Pass either a literal (`id('src')`) or `ID_PREFIXES.source`.
 */
export function id(prefix: IdPrefix): string {
  return `${prefix}_${nanoid(RANDOM_SIZE)}`;
}
