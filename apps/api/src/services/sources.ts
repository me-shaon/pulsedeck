import { getSchemaInfo, SCHEMA_VERSION, type SchemaInfo } from '@pulsedeck/schema';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import {
  categories,
  id,
  reports,
  sourceCategories,
  sourceRegistrationTokens,
  sourceStreams,
  sources,
  streams,
  type Source,
} from '../db/index.js';
import { generateApiKey, generateRegToken, hashToken } from '../auth/tokens.js';

/**
 * Source registration & management service (PRD "Source Management" +
 * "Agent Integration Protocol"). Multi-step, credential-bearing logic lives
 * here so the route module stays thin. Raw `reg_`/`pd_` values are returned to
 * the caller exactly once and only their SHA-256 hashes are persisted.
 */

/** Registration tokens live 24h (PRD "expires 24h"). */
export const REG_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * "Recent" window for the connected-agents health badge. A source seen within
 * this window is `active`; one with a key but last seen longer ago (or not since
 * registration) is `stale`; one with no key yet is `never`.
 */
export const SOURCE_RECENT_WINDOW_MS = 15 * 60 * 1000;

export type SourceScope = Source['scope'];

export type SourceHealth = 'active' | 'stale' | 'never';

/** A Drizzle transaction handle (the argument to `db.transaction`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Derive the connected-agent health badge from key presence + last-seen time. */
export function sourceHealth(
  apiKeyHash: string | null,
  lastSeenAt: Date | null,
  now: number = Date.now(),
): SourceHealth {
  if (!apiKeyHash) return 'never'; // created but never completed the handshake
  if (lastSeenAt && now - lastSeenAt.getTime() <= SOURCE_RECENT_WINDOW_MS) return 'active';
  return 'stale';
}

/**
 * Validate that every grant id named for a scope belongs to `workspaceId`.
 * Prevents an admin (or a malformed request) from granting a source write
 * access to another workspace's category/stream. Returns an error key or null.
 */
async function validateGrantOwnership(
  tx: Tx,
  workspaceId: string,
  scope: SourceScope,
  categoryIds: string[],
  streamIds: string[],
): Promise<CreateSourceError | null> {
  // A narrowed scope with no grants would leave the source unable to write
  // anywhere — surface that as an error instead of a silently-broken source.
  if (scope === 'category' && categoryIds.length === 0) return 'category_scope_requires_grants';
  if (scope === 'stream' && streamIds.length === 0) return 'stream_scope_requires_grants';

  if (scope === 'category' && categoryIds.length > 0) {
    const rows = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.workspaceId, workspaceId), inArray(categories.id, categoryIds)));
    if (rows.length !== new Set(categoryIds).size) return 'category_not_in_workspace';
  }
  if (scope === 'stream' && streamIds.length > 0) {
    // A stream belongs to the workspace iff its parent category does.
    const rows = await tx
      .select({ id: streams.id })
      .from(streams)
      .innerJoin(categories, eq(categories.id, streams.categoryId))
      .where(and(eq(categories.workspaceId, workspaceId), inArray(streams.id, streamIds)));
    if (rows.length !== new Set(streamIds).size) return 'stream_not_in_workspace';
  }
  return null;
}

/** Rewrite a source's scope grant join rows to exactly the provided id sets. */
async function rewriteGrants(
  tx: Tx,
  sourceId: string,
  scope: SourceScope,
  categoryIds: string[],
  streamIds: string[],
): Promise<void> {
  await tx.delete(sourceCategories).where(eq(sourceCategories.sourceId, sourceId));
  await tx.delete(sourceStreams).where(eq(sourceStreams.sourceId, sourceId));

  // Only the join table matching the active scope is consulted at ingest, but we
  // still only persist grants relevant to the chosen scope to avoid stale rows.
  if (scope === 'category' && categoryIds.length > 0) {
    await tx
      .insert(sourceCategories)
      .values(categoryIds.map((categoryId) => ({ sourceId, categoryId })));
  }
  if (scope === 'stream' && streamIds.length > 0) {
    await tx.insert(sourceStreams).values(streamIds.map((streamId) => ({ sourceId, streamId })));
  }
}

/**
 * Issue a fresh registration token for a source within `tx`, invalidating any
 * prior UNUSED token for that source first (re-issue supersedes the old one).
 * Returns the RAW token — caller must surface it exactly once, never store it.
 */
async function issueRegistrationTokenTx(
  tx: Tx,
  sourceId: string,
  createdBy: string,
): Promise<string> {
  // Burn any outstanding unused tokens so only the newest can ever be redeemed.
  await tx
    .update(sourceRegistrationTokens)
    .set({ usedAt: new Date() })
    .where(
      and(eq(sourceRegistrationTokens.sourceId, sourceId), isNull(sourceRegistrationTokens.usedAt)),
    );

  const rawToken = generateRegToken();
  await tx.insert(sourceRegistrationTokens).values({
    id: id('regtok'),
    sourceId,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + REG_TOKEN_TTL_MS),
    createdBy,
  });
  return rawToken;
}

export interface CreateSourceInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  scope?: SourceScope;
  allowStreamAutocreate?: boolean;
  categoryIds?: string[];
  streamIds?: string[];
}

export type CreateSourceError =
  | 'category_not_in_workspace'
  | 'stream_not_in_workspace'
  | 'category_scope_requires_grants'
  | 'stream_scope_requires_grants';

export interface CreateSourceResult {
  source: Source;
  /** Raw `reg_` token — shown to the admin exactly once. */
  registrationToken: string;
}

/**
 * Create a source row, its scope grants, and a one-time registration token,
 * atomically. The source has no API key until an agent completes the handshake.
 */
export async function createSource(
  db: Db,
  input: CreateSourceInput,
): Promise<CreateSourceResult | { error: CreateSourceError }> {
  const scope = input.scope ?? 'workspace';
  const categoryIds = input.categoryIds ?? [];
  const streamIds = input.streamIds ?? [];

  return db.transaction(async (tx) => {
    const ownership = await validateGrantOwnership(
      tx,
      input.workspaceId,
      scope,
      categoryIds,
      streamIds,
    );
    if (ownership) return { error: ownership };

    const [source] = await tx
      .insert(sources)
      .values({
        id: id('src'),
        workspaceId: input.workspaceId,
        name: input.name,
        scope,
        allowStreamAutocreate: input.allowStreamAutocreate ?? true,
      })
      .returning();

    await rewriteGrants(tx, source.id, scope, categoryIds, streamIds);
    const registrationToken = await issueRegistrationTokenTx(tx, source.id, input.createdBy);
    return { source: source as Source, registrationToken };
  });
}

/** Re-issue a registration token for an existing source (raw, once). */
export async function reissueRegistrationToken(
  db: Db,
  sourceId: string,
  createdBy: string,
): Promise<string> {
  return db.transaction((tx) => issueRegistrationTokenTx(tx, sourceId, createdBy));
}

export interface UpdateSourceInput {
  name?: string;
  scope?: SourceScope;
  allowStreamAutocreate?: boolean;
  categoryIds?: string[];
  streamIds?: string[];
}

/**
 * Update a source's name/scope/autocreate and rewrite its scope grants.
 * Validates grant ownership against the workspace before writing.
 */
export async function updateSource(
  db: Db,
  workspaceId: string,
  source: Source,
  input: UpdateSourceInput,
): Promise<Source | { error: CreateSourceError }> {
  const scope = input.scope ?? source.scope;
  const categoryIds = input.categoryIds ?? [];
  const streamIds = input.streamIds ?? [];
  const scopeOrGrantsChanged =
    input.scope !== undefined || input.categoryIds !== undefined || input.streamIds !== undefined;

  return db.transaction(async (tx) => {
    if (scopeOrGrantsChanged) {
      const ownership = await validateGrantOwnership(
        tx,
        workspaceId,
        scope,
        categoryIds,
        streamIds,
      );
      if (ownership) return { error: ownership };
    }

    const patch: Partial<typeof sources.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.scope !== undefined) patch.scope = input.scope;
    if (input.allowStreamAutocreate !== undefined)
      patch.allowStreamAutocreate = input.allowStreamAutocreate;

    let updated = source;
    if (Object.keys(patch).length > 0) {
      const [row] = await tx
        .update(sources)
        .set(patch)
        .where(eq(sources.id, source.id))
        .returning();
      updated = row as Source;
    }

    if (scopeOrGrantsChanged) {
      await rewriteGrants(tx, source.id, scope, categoryIds, streamIds);
    }
    return updated;
  });
}

/**
 * Rotate a source's API key: mint a new `pd_` key, replace the stored hash, and
 * return the raw key once. The previous key's hash is overwritten, so it stops
 * authenticating immediately.
 */
export async function rotateApiKey(db: Db, sourceId: string): Promise<string> {
  const rawKey = generateApiKey();
  await db
    .update(sources)
    .set({ apiKeyHash: hashToken(rawKey) })
    .where(eq(sources.id, sourceId));
  return rawKey;
}

/**
 * Revoke a source's API key by nulling its hash. The source row and its report
 * history remain; subsequent pushes with the old key fail bearer auth (401).
 */
export async function revokeApiKey(db: Db, sourceId: string): Promise<void> {
  await db.update(sources).set({ apiKeyHash: null }).where(eq(sources.id, sourceId));
}

export type RegisterResult =
  | { ok: true; sourceId: string; apiKey: string; schema: SchemaInfo }
  | { ok: false; reason: 'unknown' | 'expired' | 'used' };

/**
 * Complete the agent registration handshake (PRD "Registration Handshake").
 * Given a raw `reg_` token, atomically burn it and mint the source's `pd_` API
 * key. Single-use is enforced by a compare-and-swap on `used_at IS NULL` — of
 * two concurrent redemptions of the same token exactly one wins; the loser sees
 * `used`. Distinguishes unknown/expired/used so the route can map status codes.
 *
 * The source name is owned by the dashboard (set at "Add source") — the agent's
 * self-reported name is NOT applied here, so completing the handshake never
 * silently renames a source the operator already named. Only `agent_version` is
 * recorded from the agent.
 */
export async function registerSource(
  db: Db,
  rawToken: string,
  meta: { agentVersion?: string },
): Promise<RegisterResult> {
  const tokenHash = hashToken(rawToken);

  return db.transaction(async (tx) => {
    const [token] = await tx
      .select()
      .from(sourceRegistrationTokens)
      .where(eq(sourceRegistrationTokens.tokenHash, tokenHash))
      .limit(1);

    if (!token) return { ok: false, reason: 'unknown' } as const;
    if (token.usedAt) return { ok: false, reason: 'used' } as const;
    if (token.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' } as const;

    // CAS: only the redemption that flips used_at from NULL proceeds.
    const claimed = await tx
      .update(sourceRegistrationTokens)
      .set({ usedAt: new Date() })
      .where(
        and(eq(sourceRegistrationTokens.id, token.id), isNull(sourceRegistrationTokens.usedAt)),
      )
      .returning({ id: sourceRegistrationTokens.id });
    if (claimed.length === 0) return { ok: false, reason: 'used' } as const;

    const rawKey = generateApiKey();
    const patch: Partial<typeof sources.$inferInsert> = {
      apiKeyHash: hashToken(rawKey),
      // Registration is the agent's first contact → seed last-seen so the
      // connected-agents view shows it `active` immediately.
      lastSeenAt: new Date(),
    };
    if (meta.agentVersion) patch.agentVersion = meta.agentVersion;

    await tx.update(sources).set(patch).where(eq(sources.id, token.sourceId));

    return { ok: true, sourceId: token.sourceId, apiKey: rawKey, schema: getSchemaInfo() } as const;
  });
}

export interface SourceListItem {
  id: string;
  name: string;
  scope: SourceScope;
  agentVersion: string | null;
  /** Wire-contract version the source publishes against (single-version in v1). */
  schemaVersion: string;
  lastSeenAt: Date | null;
  reportCount: number;
  status: SourceHealth;
}

/** List a workspace's sources as connected-agent rows (PRD "Connected Agents"). */
export async function listSources(db: Db, workspaceId: string): Promise<SourceListItem[]> {
  const rows = await db.select().from(sources).where(eq(sources.workspaceId, workspaceId));
  if (rows.length === 0) return [];

  const sourceIds = rows.map((s) => s.id);
  const countRows = await db
    .select({ sourceId: reports.sourceId, n: count() })
    .from(reports)
    .where(inArray(reports.sourceId, sourceIds))
    .groupBy(reports.sourceId);
  const counts = new Map(countRows.map((r) => [r.sourceId, Number(r.n)]));

  const now = Date.now();
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    scope: s.scope,
    agentVersion: s.agentVersion,
    schemaVersion: SCHEMA_VERSION,
    lastSeenAt: s.lastSeenAt,
    reportCount: counts.get(s.id) ?? 0,
    status: sourceHealth(s.apiKeyHash, s.lastSeenAt, now),
  }));
}

/**
 * Render the copyable agent setup prompt (PRD "Copyable Agent Setup Prompt"),
 * self-contained so an operator can paste it into any agent with zero docs.
 * BASE_URL and the one-time registration token are filled in; the live schema
 * version is embedded and the schema-discovery URL is referenced for updates.
 */
export function buildSetupPrompt(baseUrl: string, regToken: string): string {
  return `You are integrated with PulseDeck, a reporting platform. Publish your structured
results to it by following this protocol exactly.

BASE URL: ${baseUrl}

SCHEMA VERSION: ${SCHEMA_VERSION}   # current wire-contract version

────────────────────────────────────────────────────────
STEP 1 — REGISTER (one time only)
────────────────────────────────────────────────────────
You have a one-time registration token (expires in 24h):
  REGISTRATION_TOKEN: ${regToken}

Call:
  POST ${baseUrl}/api/v1/sources/register
  Header: X-Registration-Token: ${regToken}
  Body:   { "agent_version": "<your version>" }   # the source name is set in the dashboard

Response:
  { "source_id": "src_...", "api_key": "pd_...", "schema": { ... } }

Store api_key and schema securely. The registration token is now dead — never
reuse it. If you already registered, skip to STEP 2.

────────────────────────────────────────────────────────
STEP 2 — PUBLISH A REPORT
────────────────────────────────────────────────────────
  POST ${baseUrl}/api/v1/reports
  Header: Authorization: Bearer <api_key>
  Header: Idempotency-Key: <unique id you generate per report>
  Body (must match the schema you received):

  {
    "version": "${SCHEMA_VERSION}",
    "source": { "id": "<source_id>" },
    "category": { "slug": "<category slug>" },
    "stream":   { "slug": "<stream slug>" },
    "report": {
      "title": "...",
      "summary": "...",
      "severity": "info | warning | critical",
      "occurred_at": "<ISO 8601 UTC>",
      "tags": ["..."]
    },
    "blocks": [ ... see schema; each block needs a unique "id" ... ]
  }

Generate a fresh Idempotency-Key per distinct report. If you retry the SAME
report after a network failure, reuse the SAME key — this prevents duplicates.

────────────────────────────────────────────────────────
STEP 3 — HANDLE RESPONSES
────────────────────────────────────────────────────────
  200/201  Success. Continue.
  422      Validation failed. Read "issues[]" — each has a "path" and "message".
           Fix the exact fields named, then retry ONCE. Do not loop blindly.
  401      API key invalid/revoked. Stop. Ask the operator to re-register.
  403      Not allowed to write to that category/stream. Stop, tell the operator.
  409      Unknown category/stream slug. Stop and surface to the operator —
           do not invent slugs.
  429      Rate limited. Back off exponentially (1s, 2s, 4s...) then retry.
  5xx      Server error. Back off exponentially and retry; the Idempotency-Key
           makes retries safe.

────────────────────────────────────────────────────────
RULES
────────────────────────────────────────────────────────
- Only push to category/stream slugs the operator authorized you for.
- Keep payloads within limits: <=50 blocks, <=1000 table rows, <=1 MB total.
- Never send raw HTML in markdown blocks.
- The schema may gain optional fields over time. Fetch the latest anytime:
    GET ${baseUrl}/api/v1/schema`;
}
