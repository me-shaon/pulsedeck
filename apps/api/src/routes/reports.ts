import { MAX_PAYLOAD_BYTES } from '@pulsedeck/schema';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { makeRequireSource } from '../auth/source.js';
import { hashToken, looksLikeApiKey } from '../auth/tokens.js';
import type { Report } from '../db/index.js';
import { ingestReport, ingestSchemaVersion } from '../services/ingestion.js';

/**
 * Report ingestion endpoint (PRD "Agent Integration Protocol" — the core).
 *
 * `POST /api/v1/reports`, gated by source bearer auth (`makeRequireSource`).
 * Status-code contract honored exactly:
 *   201 created · 200 idempotent replay · 400 missing Idempotency-Key ·
 *   401 bad bearer (preHandler) · 403 out-of-scope · 409 unknown slug
 *   (autocreate off) · 422 validation failure or oversize · 429 rate limited.
 *
 * Pipeline correctness lives in `services/ingestion.ts`; this module owns the
 * HTTP-layer concerns: rate limiting, payload-size measurement, the
 * Idempotency-Key requirement, and mapping the pipeline result to a status code.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** Raw request-body byte length, captured by the content-type parser. */
    rawBodyBytes: number;
  }
  interface FastifyInstance {
    /** Process-wide ingestion event bus (decorated in `buildServer`). */
    ingestionBus: import('../events/ingestion.js').IngestionBus;
  }
}

/**
 * Headroom above the 1 MB contract cap. The route accepts bodies up to this
 * ceiling so the pipeline can detect an oversize payload and answer 422 (the
 * PRD's choice — NOT Fastify's default 413). Bodies beyond the ceiling are an
 * abuse case and fall back to Fastify's hard 413; the ceiling bounds the memory
 * a single request can buffer.
 */
const BODY_LIMIT_CEILING = MAX_PAYLOAD_BYTES * 2;

/**
 * Per-source rate-limit config (PRD "per-source rate limits"), env-overridable:
 *   - `INGEST_RATE_LIMIT`  — max requests per window (default 120).
 *   - `INGEST_RATE_WINDOW` — window as ms (number) or an `ms`-style string like
 *     `"1 minute"` (default 60_000 ms).
 */
function rateLimitConfig(): { max: number; timeWindow: string | number } {
  const maxRaw = Number(process.env.INGEST_RATE_LIMIT);
  const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 120;

  const windowRaw = process.env.INGEST_RATE_WINDOW?.trim();
  let timeWindow: string | number = 60_000;
  if (windowRaw) {
    const asNumber = Number(windowRaw);
    timeWindow = Number.isFinite(asNumber) && asNumber > 0 ? asNumber : windowRaw;
  }
  return { max, timeWindow };
}

function readIdempotencyKey(request: FastifyRequest): string | null {
  const raw = request.headers['idempotency-key'];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value && value.length > 0 ? value : null;
}

/** Minimal report representation returned on accept/replay. */
function serializeReport(report: Report): Record<string, unknown> {
  return {
    id: report.id,
    stream_id: report.streamId,
    source_id: report.sourceId,
    title: report.title,
    severity: report.severity,
    occurred_at: report.occurredAt,
    received_at: report.receivedAt,
    tags: report.tags,
  };
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const requireSource = makeRequireSource(db);

  // Per-source rate limiting (PRD). Registered inside this encapsulated plugin
  // so it only governs the ingestion route. The key is the SHA-256 of the
  // presented API key, which maps 1:1 to a source (PRD "keyed by source.id") —
  // the limiter runs as an onRequest hook, BEFORE bearer auth resolves
  // `request.source`, so we derive the same identity straight from the header.
  // Unauthenticated requests fall back to IP (they 401 at the preHandler anyway).
  await app.register(rateLimit, {
    ...rateLimitConfig(),
    keyGenerator(request) {
      const header = request.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        const raw = header.slice('Bearer '.length).trim();
        // Only a well-formed key buckets per-source. Garbage/random tokens fall
        // through to a per-IP bucket so an attacker can't mint a fresh bucket
        // per request (which would both bypass the limit and evict real sources'
        // counters from the bounded in-memory store) before the auth DB lookup.
        if (looksLikeApiKey(raw)) return hashToken(raw);
      }
      return request.ip;
    },
  });

  // Capture the raw payload byte length so oversize is answered with a 422 +
  // issues[] body (not Fastify's 413). Encapsulated to this plugin; other routes
  // keep the default JSON parser. `parseAs: 'buffer'` hands us the exact bytes.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: BODY_LIMIT_CEILING },
    (request, body: Buffer, done) => {
      request.rawBodyBytes = body.length;
      if (body.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch {
        // Malformed JSON → hand the pipeline a sentinel so it answers a 422
        // validation failure (the agent-facing contract), not a bare 400.
        done(null, { __invalidJson: true });
      }
    },
  );

  app.decorateRequest('rawBodyBytes', 0);

  app.post(
    '/api/v1/reports',
    { preHandler: [requireSource], bodyLimit: BODY_LIMIT_CEILING },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const source = request.source!; // non-null after requireSource

      // (a) Idempotency-Key is required — the column is NOT NULL and retries
      //     dedup on it. Missing → 400.
      const idempotencyKey = readIdempotencyKey(request);
      if (!idempotencyKey) {
        return reply.code(400).send({ error: 'missing_idempotency_key' });
      }

      // (b) Payload cap: ≤ 1 MB → otherwise 422 (PRD chooses 422 over 413).
      if (request.rawBodyBytes > MAX_PAYLOAD_BYTES) {
        return reply.code(422).send({
          error: 'validation_failed',
          issues: [
            {
              path: '(payload)',
              message: `Payload exceeds the ${MAX_PAYLOAD_BYTES}-byte limit (${request.rawBodyBytes} bytes)`,
            },
          ],
          schema_version: ingestSchemaVersion,
        });
      }

      // (c-h) Run the pipeline (idempotent replay → validate → scope → resolve →
      //       insert + metrics → emit). The authenticated source determines the
      //       workspace; the body's source.id/workspace are ignored.
      const result = await ingestReport(db, app.ingestionBus, {
        source,
        idempotencyKey,
        payload: request.body,
      });

      switch (result.status) {
        case 'created':
          return reply
            .code(201)
            .send({ status: 'created', report: serializeReport(result.report) });
        case 'duplicate':
          return reply
            .code(200)
            .send({ status: 'duplicate', report: serializeReport(result.report) });
        case 'validation_failed':
          return reply.code(422).send({
            error: 'validation_failed',
            issues: result.issues,
            schema_version: ingestSchemaVersion,
          });
        case 'out_of_scope':
          return reply.code(403).send({ error: 'out_of_scope' });
        case 'unknown_slug':
          return reply.code(409).send({ error: 'unknown_slug', which: result.which });
        default: {
          // Exhaustiveness guard: a new IngestResult variant becomes a compile
          // error here rather than a silently unanswered request.
          const _exhaustive: never = result;
          return reply.code(500).send({ error: 'Internal Server Error', _exhaustive });
        }
      }
    },
  );
}
