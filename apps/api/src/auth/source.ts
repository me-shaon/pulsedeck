import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Db } from '../db/index.js';
import { sources, type Source } from '../db/index.js';
import { hashToken, looksLikeApiKey } from './tokens.js';

/**
 * Source bearer-auth for the agent ingestion path (PRD "Agent Integration
 * Protocol"). Agents authenticate every push with `Authorization: Bearer pd_…`.
 * Provided here for Phase 5 ingestion to consume.
 *
 * Resolution is by SHA-256 hash: the presented key is hashed and matched against
 * the indexed `api_key_hash` column. A revoked source has a NULL hash, which no
 * presented key can hash to, so revocation yields 401 for free. The raw key is
 * never logged.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated source, set by `requireSource`. Null until then. */
    source: Source | null;
  }
}

/**
 * preHandler factory: authenticate the request as a source via its `pd_` API
 * key. Responds 401 (and halts) when the header is missing, malformed, or the
 * key is unknown/revoked. On success sets `request.source` and bumps
 * `last_seen_at` without blocking the request (fire-and-forget).
 */
export function makeRequireSource(db: Db): preHandlerHookHandler {
  return async function requireSource(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      await reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const rawKey = header.slice('Bearer '.length).trim();
    // Cheap shape check before hitting the DB; a non-`pd_` token can never match.
    if (!looksLikeApiKey(rawKey)) {
      await reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const [source] = await db
      .select()
      .from(sources)
      .where(eq(sources.apiKeyHash, hashToken(rawKey)))
      .limit(1);
    if (!source) {
      await reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    request.source = source;

    // Fire-and-forget last-seen bump: ingestion must not block on, or fail
    // because of, this bookkeeping write. Errors are swallowed deliberately.
    void db
      .update(sources)
      .set({ lastSeenAt: new Date() })
      .where(eq(sources.id, source.id))
      .catch((err) => {
        request.log.warn({ err, sourceId: source.id }, 'failed to bump source last_seen_at');
      });
  };
}
