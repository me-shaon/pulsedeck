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
import { slugify } from './structure.js';

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

export type SourceHealth = 'active' | 'stale' | 'never' | 'revoked';

/** A Drizzle transaction handle (the argument to `db.transaction`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Derive the connected-agent health badge. `revoked` (operator disabled the
 * source) takes precedence over key/last-seen state so a deliberately revoked
 * agent is never shown as merely "never connected" — both have a null key hash,
 * but only a revoked one has `revokedAt`.
 */
export function sourceHealth(
  apiKeyHash: string | null,
  lastSeenAt: Date | null,
  now: number = Date.now(),
  revokedAt: Date | null = null,
): SourceHealth {
  if (revokedAt) return 'revoked';
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
  // Rotating a key re-enables a revoked source (it hands out a working key).
  await db
    .update(sources)
    .set({ apiKeyHash: hashToken(rawKey), revokedAt: null })
    .where(eq(sources.id, sourceId));
  return rawKey;
}

/**
 * Revoke a source: null its API-key hash AND stamp `revoked_at`. The source row
 * and its report history remain; subsequent pushes with the old key fail bearer
 * auth (401). The timestamp marks the source as deliberately disabled (distinct
 * from never-registered), so the dashboard can hide it by default. Re-issuing a
 * token + re-registering, or rotating a key, clears the mark.
 */
export async function revokeApiKey(db: Db, sourceId: string): Promise<void> {
  await db
    .update(sources)
    .set({ apiKeyHash: null, revokedAt: new Date() })
    .where(eq(sources.id, sourceId));
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
      // Re-registering a previously revoked source re-enables it.
      revokedAt: null,
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
    status: sourceHealth(s.apiKeyHash, s.lastSeenAt, now, s.revokedAt),
  }));
}

/** The per-workspace system lane every agent reports its own status to. */
export const AGENT_UPDATES_CATEGORY_SLUG = 'agent-updates';
export const AGENT_UPDATES_CATEGORY_NAME = 'Agent updates';

/** Condense a multi-line task to one short phrase for the setup-confirmation line. */
function summarizeTask(task: string): string {
  const firstLine = task.trim().split('\n')[0].trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

/** Pick a stream slug free within `categoryId`, deduping `base` with `-2`, `-3`… */
async function uniqueStreamSlug(tx: Tx, categoryId: string, base: string): Promise<string> {
  const rows = await tx
    .select({ slug: streams.slug })
    .from(streams)
    .where(eq(streams.categoryId, categoryId));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 76)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Provision (idempotently) this source's slot in the workspace's "Agent updates"
 * lane and grant it write access, returning the status stream slug to embed in
 * the setup prompt. Called at prompt-generation, before the agent ever registers,
 * so the slug the operator copies is the slug that exists.
 *
 * The lane is one system category ("agent-updates") with one stream per source
 * (named after the agent). Grants are inserted for BOTH join tables so the lane
 * is reachable regardless of the source's scope: category-scoped sources are
 * gated on `source_categories`, stream-scoped on `source_streams`, and
 * workspace-scoped sources ignore both — inserting both covers every case
 * without touching ingestion's scope check.
 */
export async function ensureAgentUpdatesDestination(
  db: Db,
  source: Source,
): Promise<{ categorySlug: string; streamSlug: string }> {
  return db.transaction(async (tx) => {
    // 1. Ensure the workspace's system "Agent updates" category.
    await tx
      .insert(categories)
      .values({
        id: id('cat'),
        workspaceId: source.workspaceId,
        name: AGENT_UPDATES_CATEGORY_NAME,
        slug: AGENT_UPDATES_CATEGORY_SLUG,
        labelSource: 'user',
        system: true,
      })
      .onConflictDoNothing({ target: [categories.workspaceId, categories.slug] });
    const [cat] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.workspaceId, source.workspaceId),
          eq(categories.slug, AGENT_UPDATES_CATEGORY_SLUG),
        ),
      )
      .limit(1);

    // 2. Reuse this source's existing status stream if it already has one
    //    (regeneration must be stable — never mint a fresh `-2` each time).
    const [existing] = await tx
      .select({ slug: streams.slug })
      .from(streams)
      .innerJoin(sourceStreams, eq(sourceStreams.streamId, streams.id))
      .where(and(eq(streams.categoryId, cat.id), eq(sourceStreams.sourceId, source.id)))
      .limit(1);

    let streamSlug: string;
    if (existing) {
      streamSlug = existing.slug;
    } else {
      // 3. Mint a per-agent stream, slug derived from the agent name.
      streamSlug = await uniqueStreamSlug(tx, cat.id, slugify(source.name) || 'agent');
      const [stream] = await tx
        .insert(streams)
        .values({
          id: id('stm'),
          categoryId: cat.id,
          name: source.name,
          slug: streamSlug,
          labelSource: 'user',
        })
        .returning({ id: streams.id });
      await tx
        .insert(sourceStreams)
        .values({ sourceId: source.id, streamId: stream.id })
        .onConflictDoNothing();
    }

    // 4. Grant the category too, so a category-scoped source can reach the lane.
    await tx
      .insert(sourceCategories)
      .values({ sourceId: source.id, categoryId: cat.id })
      .onConflictDoNothing();

    return { categorySlug: AGENT_UPDATES_CATEGORY_SLUG, streamSlug };
  });
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
STEP 4 — REMEMBER THIS (do it once, so you never need this prompt again)
────────────────────────────────────────────────────────
This prompt is one-time setup. Persist the integration so future reporting
needs no re-paste:
- If you support reusable skills (e.g. Claude Code), create a skill named
  "pulsedeck" capturing this protocol: the BASE URL, the register/publish
  endpoints, the report schema, the response-handling rules, and how to fetch
  the latest schema.
- Save to your long-term memory: the BASE URL, your source_id, the SCHEMA
  VERSION, and that registration is already complete (STEP 1 is done).
- Keep a task→destination map: record which category/stream slug each task /
  cron / scheduled job reports to, so every job's output consistently lands in
  the same place. Reuse those slugs; ask the operator (don't invent) when a new
  task needs a destination that doesn't exist yet.
- Store the api_key in a SECRET store or env var — never in plaintext skill or
  memory files. Record only WHERE it lives, not the key itself.
Next time a task runs, look up its destination in that map and go straight to
STEP 2. Do not ask for this prompt again.

────────────────────────────────────────────────────────
RULES
────────────────────────────────────────────────────────
- Only push to category/stream slugs the operator authorized you for.
- Keep payloads within limits: <=50 blocks, <=1000 table rows, <=1 MB total.
- Never send raw HTML in markdown blocks.
- The schema may gain optional fields over time. Fetch the latest anytime:
    GET ${baseUrl}/api/v1/schema`;
}

export type InstructionDestination =
  | { categorySlug: string; streamSlug: string }
  | { categorySlug: string; streamSlug?: undefined };

/**
 * Render a destination-scoped variant of {@link buildSetupPrompt}: STEP 2's body
 * has the chosen category (and, for a stream-level destination, stream) slug
 * pre-filled, so the operator pastes it into an agent and is done. Category-level
 * leaves the stream choice to the agent (autocreate is on).
 */
export interface DestinationPromptOptions {
  /** Operator's free-text task instruction; rendered verbatim, never stored. */
  task?: string;
  /** Slug of this source's stream in the "agent-updates" lane (see {@link ensureAgentUpdatesDestination}). */
  statusStreamSlug: string;
}

export function buildDestinationSetupPrompt(
  baseUrl: string,
  regToken: string,
  dest: InstructionDestination,
  opts: DestinationPromptOptions,
): string {
  const statusSlug = opts.statusStreamSlug;
  const categoryLine = `"category": { "slug": "${dest.categorySlug}" },`;
  const streamLine = dest.streamSlug
    ? `"stream":   { "slug": "${dest.streamSlug}" },`
    : `"stream":   { "slug": "<choose or create a stream under '${dest.categorySlug}'>" },`;
  const destNote = dest.streamSlug
    ? `Push every report to category "${dest.categorySlug}", stream "${dest.streamSlug}".`
    : `Push reports to category "${dest.categorySlug}"; choose or create a stream slug per report.`;

  const task = opts.task?.trim();
  const taskSection = task
    ? `────────────────────────────────────────────────────────
YOUR TASK
────────────────────────────────────────────────────────
${task}

`
    : '';

  return `You are integrated with PulseDeck, a reporting platform. Publish your structured
results to it by following this protocol exactly.

${taskSection}Report your FINDINGS to:  ${destNote}
Report your OWN STATUS to: category "${AGENT_UPDATES_CATEGORY_SLUG}", stream "${statusSlug}".

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
  Body:   { "agent_version": "<your version>" }

Response:
  { "source_id": "src_...", "api_key": "pd_...", "schema": { ... } }

Store api_key securely. The registration token is now dead — never reuse it.

────────────────────────────────────────────────────────
STEP 2 — PUBLISH A REPORT
────────────────────────────────────────────────────────
  POST ${baseUrl}/api/v1/reports
  Header: Authorization: Bearer <api_key>
  Header: Idempotency-Key: <unique id you generate per report>
  Body:

  {
    "version": "${SCHEMA_VERSION}",
    "source": { "id": "<source_id>" },
    ${categoryLine}
    ${streamLine}
    "report": {
      "title": "...",
      "summary": "...",
      "severity": "info | warning | critical",
      "occurred_at": "<ISO 8601 UTC>",
      "tags": ["..."]
    },
    "blocks": [ ... see schema; each block needs a unique "id" ... ]
  }

Reuse the SAME Idempotency-Key only when retrying the SAME report.

────────────────────────────────────────────────────────
STEP 3 — HANDLE RESPONSES
────────────────────────────────────────────────────────
  200/201  Success.
  422      Validation failed. Read "issues[]", fix named fields, retry ONCE.
  401      API key invalid/revoked. Stop; ask the operator to re-register.
  403      Not allowed to write there. Stop, tell the operator.
  409      Unknown slug with autocreate disabled. Stop; do not invent slugs.
  429      Rate limited. Back off exponentially, then retry.
  5xx      Server error. Back off and retry; the Idempotency-Key makes it safe.

────────────────────────────────────────────────────────
AGENT STATUS — category "${AGENT_UPDATES_CATEGORY_SLUG}", stream "${statusSlug}"
────────────────────────────────────────────────────────
This is your own operational lane, separate from your findings. Report YOUR
state here; report what you observe to the destination above. Never mix them: a
monitored thing failing is a FINDING; YOU being unable to run is a STATUS update.

Right after STEP 1 registers you, publish one setup-confirmation here
(severity: info — "setup complete${task ? ' — I will ' + summarizeTask(task) : ''}").
After that, post here ONLY on these events (routine results stay findings):
  - you cannot run the task ... critical  (crash, exception, network down, bad target creds)
  - partial failure .......... warning   (ran, but some sub-tasks couldn't execute)
  - recovered ................ info      (first good run after a failure)
  - your own creds expiring .. warning   (a token/key YOUR task needs — not the PulseDeck key)

────────────────────────────────────────────────────────
STEP 4 — REMEMBER THIS (do it once, so you never need this prompt again)
────────────────────────────────────────────────────────
This prompt is one-time setup. Persist the integration so future reporting
needs no re-paste:
- If you support reusable skills (e.g. Claude Code), create a skill named
  "pulsedeck" capturing this protocol, the BASE URL, and the response-handling
  rules.
- Save to your long-term memory: the BASE URL, your source_id, the SCHEMA
  VERSION, and that registration is already complete.
- Record the ROUTING for this destination: which task / cron / scheduled job
  reports to it (${destNote.replace(/\.$/, '')}). Keep a task→destination map so
  each job's output always lands in the right category/stream. When a new kind
  of task needs its own destination, ask the operator to add a category/stream
  and copy a fresh prompt for it — do NOT invent slugs.
- Store the api_key in a SECRET store or env var — never in plaintext skill or
  memory files. Record only WHERE it lives, not the key itself.
Next time a task runs, look up its destination in that map and go straight to
STEP 2. Do not ask for this prompt again.

Full wire schema anytime: GET ${baseUrl}/api/v1/schema`;
}
