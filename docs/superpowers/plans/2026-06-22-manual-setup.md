# Manual Setup of Categories & Streams + Agent Instruction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators create/rename/reorder/delete categories & streams in the UI and copy a paste-ready, destination-scoped agent instruction — without breaking today's agent auto-create.

**Architecture:** New `structure` service + routes for category/stream CRUD + reorder, reusing existing RBAC (`categories:create`, `streams:create`) and the `sources:manage` gate for token-bearing instruction endpoints. A `label_source` column records whether a name is operator-set so agent pushes never clobber it. A `buildDestinationSetupPrompt` sibling to `buildSetupPrompt` pre-fills the chosen slug(s). The web sidebar tree gains inline controls, drag-reorder, and an instructions dialog.

**Tech Stack:** Fastify 5, Drizzle ORM, PostgreSQL 16, Zod, Vitest (`apps/api/test/*.integration.test.ts`, gated on `DATABASE_URL`), React 19 + TanStack Router/Query, Radix UI, Tailwind.

**Branch:** `feat/manual-setup` (already checked out, synced to `origin/main` @ `7542c28`).

**Spec:** `docs/superpowers/specs/2026-06-22-manual-setup-design.md`

---

## File Structure

**API — create:**

- `apps/api/src/services/structure.ts` — category/stream CRUD + reorder + ownership checks + slugify.
- `apps/api/src/routes/structure.ts` — HTTP layer, Zod bodies, RBAC gates, agent-instructions endpoints.
- `apps/api/test/structure.integration.test.ts` — integration tests.

**API — modify:**

- `apps/api/src/db/schema/categories.ts` — add `labelSource`.
- `apps/api/src/db/schema/streams.ts` — add `labelSource`.
- `apps/api/src/services/ingestion.ts` — autocreate sets `labelSource: 'auto'` (explicit).
- `apps/api/src/services/sources.ts` — add `buildDestinationSetupPrompt`.
- `apps/api/src/services/reports-query.ts` — `getTree` returns `labelSource`.
- `apps/api/src/server.ts` (or wherever routes register) — register `structureRoutes`.
- New migration `apps/api/drizzle/0006_*.sql` via `pnpm --filter @pulsedeck/api db:generate`.

**Web — modify:**

- `apps/web/src/lib/api.ts` — typed methods for new endpoints + `labelSource` in tree types.
- `apps/web/src/hooks/use-workspace-data.ts` — structure mutations + instructions query.
- `apps/web/src/components/app-shell/sidebar.tsx` — inline controls, badges, drag-reorder, empty state.

**Web — create:**

- `apps/web/src/components/structure/structure-dialogs.tsx` — Category/Stream create+rename, delete confirm.
- `apps/web/src/components/structure/agent-instructions-dialog.tsx` — source picker + copy box.

**E2E — create:**

- `apps/e2e/tests/manual-setup.spec.ts`.

---

## Task 1: `label_source` schema + migration

**Files:**

- Modify: `apps/api/src/db/schema/categories.ts`
- Modify: `apps/api/src/db/schema/streams.ts`
- Create: `apps/api/drizzle/0006_*.sql` (generated)

- [ ] **Step 1: Add column to categories schema**

In `apps/api/src/db/schema/categories.ts`, add the import for nothing new (still `text`), and add the column after `slug`:

```ts
export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    // 'auto' = name derived from slug at autocreate; 'user' = operator set it.
    // Operator-set names are never overwritten by later agent pushes.
    labelSource: text('label_source', { enum: ['auto', 'user'] })
      .notNull()
      .default('auto'),
    position: integer('position').notNull().default(0),
  },
  (t) => [uniqueIndex('categories_workspace_slug_uq').on(t.workspaceId, t.slug)],
);
```

- [ ] **Step 2: Add the same column to streams schema**

In `apps/api/src/db/schema/streams.ts`, add after `slug`:

```ts
    labelSource: text('label_source', { enum: ['auto', 'user'] })
      .notNull()
      .default('auto'),
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @pulsedeck/api db:generate`
Expected: a new `apps/api/drizzle/0006_*.sql` adding `label_source` to both tables with `DEFAULT 'auto' NOT NULL`, plus an updated `meta/_journal.json` + `0006_snapshot.json`. Existing rows backfill to `'auto'` automatically via the column default.

- [ ] **Step 4: Apply + verify migration**

Run: `pnpm --filter @pulsedeck/api db:migrate`
Expected: migration `0006` applied with no error. (Requires `DATABASE_URL`.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema/categories.ts apps/api/src/db/schema/streams.ts apps/api/drizzle
git commit -m "feat(db): add label_source to categories and streams"
```

---

## Task 2: Ingestion sets `label_source: 'auto'` explicitly

Autocreate currently inserts without `labelSource` (relies on default). Make it explicit so intent is clear and a future name-bearing wire contract is guarded.

**Files:**

- Modify: `apps/api/src/services/ingestion.ts:114-123` (`createCategory`) and `:138-145` (`createStream`)

- [ ] **Step 1: Set labelSource in createCategory**

Change the insert values in `createCategory`:

```ts
await tx
  .insert(categories)
  .values({ id: id('cat'), workspaceId, name: titleFromSlug(slug), slug, labelSource: 'auto' })
  .onConflictDoNothing({ target: [categories.workspaceId, categories.slug] });
```

- [ ] **Step 2: Set labelSource in createStream**

```ts
await tx
  .insert(streams)
  .values({ id: id('stm'), categoryId, name: titleFromSlug(slug), slug, labelSource: 'auto' })
  .onConflictDoNothing({ target: [streams.categoryId, streams.slug] });
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pulsedeck/api typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/ingestion.ts
git commit -m "feat(api): mark autocreated categories/streams as label_source=auto"
```

---

## Task 3: `structure` service — create category (TDD)

**Files:**

- Create: `apps/api/src/services/structure.ts`
- Create: `apps/api/test/structure.integration.test.ts`

- [ ] **Step 1: Write the failing test (create category)**

Create `apps/api/test/structure.integration.test.ts`. Copy the `beforeAll`/`afterAll` harness from `apps/api/test/sources.integration.test.ts` (postgres-js `max:5`, `runMigrations`, the `TRUNCATE ...` statement, `/api/v1/setup` to get `workspaceId` + `adminCookie`, and an editor + viewer member via invite/accept — reuse that file's exact member-bootstrap block). Then add:

```ts
import { createCategory as createCategorySvc } from '../src/services/structure.js';

it('creates a category with a derived slug and labelSource=user', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/categories`,
    headers: { cookie: adminCookie },
    payload: { name: 'Daily Infra' },
  });
  expect(res.statusCode).toBe(201);
  const cat = res.json().category;
  expect(cat.slug).toBe('daily-infra');
  expect(cat.name).toBe('Daily Infra');
  expect(cat.labelSource).toBe('user');
});
```

(The route arrives in Task 7; for now this test drives the service via the route, so it will fail at the route layer. To keep this task service-only, also add a direct service test:)

```ts
it('service: createCategory derives slug, sets position max+1', async () => {
  const a = await createCategorySvc(db, { workspaceId, name: 'Infra' });
  if ('error' in a) throw new Error(a.error);
  expect(a.category.slug).toBe('infra');
  expect(a.category.labelSource).toBe('user');
  const b = await createCategorySvc(db, { workspaceId, name: 'Ops' });
  if ('error' in b) throw new Error(b.error);
  expect(b.category.position).toBe(a.category.position + 1);
});

it('service: createCategory returns slug_exists on duplicate slug', async () => {
  await createCategorySvc(db, { workspaceId, name: 'Dup', slug: 'dup' });
  const again = await createCategorySvc(db, { workspaceId, name: 'Dup 2', slug: 'dup' });
  expect('error' in again && again.error).toBe('slug_exists');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @pulsedeck/api test -- structure`
Expected: FAIL — `Cannot find module '../src/services/structure.js'`.

- [ ] **Step 3: Implement structure.ts (slugify + createCategory)**

Create `apps/api/src/services/structure.ts`:

```ts
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { categories, id, streams, type Category, type Stream } from '../db/index.js';

/** A Drizzle transaction handle. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type StructureError = 'slug_exists' | 'not_found' | 'bad_order';

/** Slugify a display name: lowercase, non-alphanumerics → single hyphen, trim. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Next position within a parent scope: max(position)+1, 0 when empty. */
async function nextCategoryPosition(db: Db, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${categories.position})` })
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId));
  return (row?.max ?? -1) + 1;
}

export interface CreateCategoryInput {
  workspaceId: string;
  name: string;
  slug?: string;
  position?: number;
}

export async function createCategory(
  db: Db,
  input: CreateCategoryInput,
): Promise<{ category: Category } | { error: StructureError }> {
  const slug = input.slug?.trim() ? slugify(input.slug) : slugify(input.name);
  if (!slug) return { error: 'slug_exists' }; // empty slug is unusable; treat as conflict-class error
  const position = input.position ?? (await nextCategoryPosition(db, input.workspaceId));

  const inserted = await db
    .insert(categories)
    .values({
      id: id('cat'),
      workspaceId: input.workspaceId,
      name: input.name,
      slug,
      labelSource: 'user',
      position,
    })
    .onConflictDoNothing({ target: [categories.workspaceId, categories.slug] })
    .returning();

  if (inserted.length === 0) return { error: 'slug_exists' };
  return { category: inserted[0] };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @pulsedeck/api test -- structure`
Expected: the two `service:` tests PASS; the route test still FAILS (route added in Task 7). That is expected — leave it.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/structure.ts apps/api/test/structure.integration.test.ts
git commit -m "feat(api): structure service - createCategory + slugify"
```

---

## Task 4: structure service — create stream, rename, delete, reorder (TDD)

**Files:**

- Modify: `apps/api/src/services/structure.ts`
- Modify: `apps/api/test/structure.integration.test.ts`

- [ ] **Step 1: Write failing tests**

Append to the test file:

```ts
import {
  createStream as createStreamSvc,
  renameCategory,
  renameStream,
  deleteCategory,
  deleteStream,
  reorderCategories,
  reorderStreams,
} from '../src/services/structure.js';

it('service: createStream under a category, slug derived', async () => {
  const c = await createCategorySvc(db, { workspaceId, name: 'CI' });
  if ('error' in c) throw new Error(c.error);
  const s = await createStreamSvc(db, {
    workspaceId,
    categoryId: c.category.id,
    name: 'Build Status',
  });
  if ('error' in s) throw new Error(s.error);
  expect(s.stream.slug).toBe('build-status');
  expect(s.stream.labelSource).toBe('user');
});

it('service: createStream rejects a category from another workspace', async () => {
  const res = await createStreamSvc(db, {
    workspaceId,
    categoryId: 'cat_does_not_exist',
    name: 'X',
  });
  expect('error' in res && res.error).toBe('not_found');
});

it('service: renameCategory sets name + labelSource=user, keeps slug', async () => {
  const c = await createCategorySvc(db, { workspaceId, name: 'Old', slug: 'keepme' });
  if ('error' in c) throw new Error(c.error);
  const r = await renameCategory(db, workspaceId, c.category.id, 'New Name');
  if ('error' in r) throw new Error(r.error);
  expect(r.category.name).toBe('New Name');
  expect(r.category.slug).toBe('keepme');
  expect(r.category.labelSource).toBe('user');
});

it('service: deleteCategory cascades its streams', async () => {
  const c = await createCategorySvc(db, { workspaceId, name: 'Doomed' });
  if ('error' in c) throw new Error(c.error);
  await createStreamSvc(db, { workspaceId, categoryId: c.category.id, name: 'S1' });
  const del = await deleteCategory(db, workspaceId, c.category.id);
  expect(del).toEqual({ ok: true });
  const rows = await db.select().from(streams).where(eq(streams.categoryId, c.category.id));
  expect(rows.length).toBe(0);
});

it('service: reorderCategories sets position by index', async () => {
  const a = await createCategorySvc(db, { workspaceId, name: 'AA' });
  const b = await createCategorySvc(db, { workspaceId, name: 'BB' });
  if ('error' in a || 'error' in b) throw new Error('setup');
  const r = await reorderCategories(db, workspaceId, [b.category.id, a.category.id]);
  expect(r).toEqual({ ok: true });
  const [bRow] = await db.select().from(categories).where(eq(categories.id, b.category.id));
  const [aRow] = await db.select().from(categories).where(eq(categories.id, a.category.id));
  expect(bRow.position).toBe(0);
  expect(aRow.position).toBe(1);
});

it('service: reorderCategories rejects ids outside the workspace', async () => {
  const r = await reorderCategories(db, workspaceId, ['cat_not_here']);
  expect('error' in r && r.error).toBe('bad_order');
});
```

(`eq`, `categories`, `streams` are already imported at the top of the test file from the harness copy.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @pulsedeck/api test -- structure`
Expected: FAIL — exports `createStream`, `renameCategory`, etc. not found.

- [ ] **Step 3: Implement the remaining service functions**

Append to `apps/api/src/services/structure.ts`:

```ts
/** Confirm a category belongs to the workspace; returns it or null. */
async function loadCategory(db: Db, workspaceId: string, categoryId: string) {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

/** Confirm a stream belongs to the workspace (via its category); returns it or null. */
async function loadStream(db: Db, workspaceId: string, streamId: string) {
  const [row] = await db
    .select({ stream: streams })
    .from(streams)
    .innerJoin(categories, eq(categories.id, streams.categoryId))
    .where(and(eq(streams.id, streamId), eq(categories.workspaceId, workspaceId)))
    .limit(1);
  return row?.stream ?? null;
}

async function nextStreamPosition(db: Db, categoryId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${streams.position})` })
    .from(streams)
    .where(eq(streams.categoryId, categoryId));
  return (row?.max ?? -1) + 1;
}

export interface CreateStreamInput {
  workspaceId: string;
  categoryId: string;
  name: string;
  slug?: string;
  position?: number;
}

export async function createStream(
  db: Db,
  input: CreateStreamInput,
): Promise<{ stream: Stream } | { error: StructureError }> {
  const category = await loadCategory(db, input.workspaceId, input.categoryId);
  if (!category) return { error: 'not_found' };

  const slug = input.slug?.trim() ? slugify(input.slug) : slugify(input.name);
  if (!slug) return { error: 'slug_exists' };
  const position = input.position ?? (await nextStreamPosition(db, input.categoryId));

  const inserted = await db
    .insert(streams)
    .values({
      id: id('stm'),
      categoryId: input.categoryId,
      name: input.name,
      slug,
      labelSource: 'user',
      position,
    })
    .onConflictDoNothing({ target: [streams.categoryId, streams.slug] })
    .returning();
  if (inserted.length === 0) return { error: 'slug_exists' };
  return { stream: inserted[0] };
}

export async function renameCategory(
  db: Db,
  workspaceId: string,
  categoryId: string,
  name: string,
): Promise<{ category: Category } | { error: StructureError }> {
  const existing = await loadCategory(db, workspaceId, categoryId);
  if (!existing) return { error: 'not_found' };
  const [row] = await db
    .update(categories)
    .set({ name, labelSource: 'user' })
    .where(eq(categories.id, categoryId))
    .returning();
  return { category: row };
}

export async function renameStream(
  db: Db,
  workspaceId: string,
  streamId: string,
  name: string,
): Promise<{ stream: Stream } | { error: StructureError }> {
  const existing = await loadStream(db, workspaceId, streamId);
  if (!existing) return { error: 'not_found' };
  const [row] = await db
    .update(streams)
    .set({ name, labelSource: 'user' })
    .where(eq(streams.id, streamId))
    .returning();
  return { stream: row };
}

export async function deleteCategory(
  db: Db,
  workspaceId: string,
  categoryId: string,
): Promise<{ ok: true } | { error: StructureError }> {
  const existing = await loadCategory(db, workspaceId, categoryId);
  if (!existing) return { error: 'not_found' };
  await db.delete(categories).where(eq(categories.id, categoryId)); // FK cascade → streams → reports
  return { ok: true };
}

export async function deleteStream(
  db: Db,
  workspaceId: string,
  streamId: string,
): Promise<{ ok: true } | { error: StructureError }> {
  const existing = await loadStream(db, workspaceId, streamId);
  if (!existing) return { error: 'not_found' };
  await db.delete(streams).where(eq(streams.id, streamId)); // FK cascade → reports
  return { ok: true };
}

/** Set position = index for the given ordered ids; all must be in scope. */
export async function reorderCategories(
  db: Db,
  workspaceId: string,
  ids: string[],
): Promise<{ ok: true } | { error: StructureError }> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId));
  const owned = new Set(rows.map((r) => r.id));
  if (ids.length === 0 || !ids.every((i) => owned.has(i))) return { error: 'bad_order' };
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.update(categories).set({ position: i }).where(eq(categories.id, ids[i]));
    }
  });
  return { ok: true };
}

export async function reorderStreams(
  db: Db,
  workspaceId: string,
  categoryId: string,
  ids: string[],
): Promise<{ ok: true } | { error: StructureError }> {
  const category = await loadCategory(db, workspaceId, categoryId);
  if (!category) return { error: 'not_found' };
  const rows = await db
    .select({ id: streams.id })
    .from(streams)
    .where(eq(streams.categoryId, categoryId));
  const owned = new Set(rows.map((r) => r.id));
  if (ids.length === 0 || !ids.every((i) => owned.has(i))) return { error: 'bad_order' };
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.update(streams).set({ position: i }).where(eq(streams.id, ids[i]));
    }
  });
  return { ok: true };
}
```

Remove the now-unused `asc` import if eslint flags it.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @pulsedeck/api test -- structure`
Expected: all `service:` tests PASS (route test still fails until Task 7).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/structure.ts apps/api/test/structure.integration.test.ts
git commit -m "feat(api): structure service - stream CRUD, rename, delete, reorder"
```

---

## Task 5: `buildDestinationSetupPrompt` (TDD)

**Files:**

- Modify: `apps/api/src/services/sources.ts`
- Create: `apps/api/test/setup-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/setup-prompt.test.ts` (pure unit test, no DB):

```ts
import { describe, expect, it } from 'vitest';
import { buildDestinationSetupPrompt } from '../src/services/sources.js';

describe('buildDestinationSetupPrompt', () => {
  const base = 'https://pd.example';
  const tok = 'reg_abc';

  it('stream-level pins both slugs', () => {
    const p = buildDestinationSetupPrompt(base, tok, {
      categorySlug: 'infra',
      streamSlug: 'system-health',
    });
    expect(p).toContain('"category": { "slug": "infra" }');
    expect(p).toContain('"stream":   { "slug": "system-health" }');
    expect(p).toContain(tok);
    expect(p).not.toContain('<category slug>');
  });

  it('category-level pins category, guides stream choice', () => {
    const p = buildDestinationSetupPrompt(base, tok, { categorySlug: 'infra' });
    expect(p).toContain('"category": { "slug": "infra" }');
    expect(p).toContain('choose or create a stream');
    expect(p).not.toContain('<category slug>');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @pulsedeck/api test -- setup-prompt`
Expected: FAIL — `buildDestinationSetupPrompt` not exported.

- [ ] **Step 3: Implement the builder**

In `apps/api/src/services/sources.ts`, after `buildSetupPrompt`, add:

```ts
export type InstructionDestination =
  | { categorySlug: string; streamSlug: string }
  | { categorySlug: string; streamSlug?: undefined };

/**
 * Render a destination-scoped variant of {@link buildSetupPrompt}: STEP 2's body
 * has the chosen category (and, for a stream-level destination, stream) slug
 * pre-filled, so the operator pastes it into an agent and is done. Category-level
 * leaves stream choice to the agent (autocreate is on).
 */
export function buildDestinationSetupPrompt(
  baseUrl: string,
  regToken: string,
  dest: InstructionDestination,
): string {
  const categoryLine = `"category": { "slug": "${dest.categorySlug}" },`;
  const streamLine = dest.streamSlug
    ? `"stream":   { "slug": "${dest.streamSlug}" },`
    : `"stream":   { "slug": "<choose or create a stream under '${dest.categorySlug}'>" },`;
  const destNote = dest.streamSlug
    ? `Push every report to category "${dest.categorySlug}", stream "${dest.streamSlug}".`
    : `Push reports to category "${dest.categorySlug}"; choose or create a stream slug per report.`;

  return `You are integrated with PulseDeck, a reporting platform. Publish your structured
results to it by following this protocol exactly.

${destNote}

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

Full wire schema anytime: GET ${baseUrl}/api/v1/schema`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @pulsedeck/api test -- setup-prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/sources.ts apps/api/test/setup-prompt.test.ts
git commit -m "feat(api): destination-scoped agent setup prompt builder"
```

---

## Task 6: `getTree` returns `labelSource`

**Files:**

- Modify: `apps/api/src/services/reports-query.ts` (`TreeStream`, `TreeCategory`, `getTree`)
- Modify: `apps/api/test/reports-read.integration.test.ts` (assert field present)

- [ ] **Step 1: Add labelSource to the test**

In `apps/api/test/reports-read.integration.test.ts`, find the tree assertion block and add an expectation that a category and a stream node include `labelSource` (e.g. `expect(cat).toHaveProperty('labelSource')`). If no tree test exists there, add a minimal one that pushes a report (autocreate) then GETs `/api/v1/workspaces/:id/tree` and asserts `categories[0].labelSource === 'auto'` and `categories[0].streams[0].labelSource === 'auto'`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @pulsedeck/api test -- reports-read`
Expected: FAIL — `labelSource` undefined on tree nodes.

- [ ] **Step 3: Extend the types + queries**

In `apps/api/src/services/reports-query.ts`:

Add to `TreeStream` and `TreeCategory` interfaces:

```ts
labelSource: 'auto' | 'user';
```

In `getTree`, add `labelSource: categories.labelSource` to the `cats` select, and `labelSource: streams.labelSource` to the `streamRows` select (and to its `as unknown as Array<{...}>` cast type). Include `labelSource: s.labelSource` when pushing each `TreeStream`, and `labelSource: c.labelSource` when building each category node (find the category-node construction just below the shown excerpt and add the field).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @pulsedeck/api test -- reports-read`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/reports-query.ts apps/api/test/reports-read.integration.test.ts
git commit -m "feat(api): expose label_source in navigation tree"
```

---

## Task 7: structure routes + agent-instructions endpoints (TDD)

**Files:**

- Create: `apps/api/src/routes/structure.ts`
- Modify: route registration site (search: `app.register(sourceRoutes)` or `sourceRoutes(app)` in `apps/api/src/server.ts`)
- Modify: `apps/api/test/structure.integration.test.ts`

- [ ] **Step 1: Write failing route + RBAC + instructions tests**

Append to `apps/api/test/structure.integration.test.ts`:

```ts
it('route: editor can create a category', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/categories`,
    headers: { cookie: editorCookie },
    payload: { name: 'Editor Cat' },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().category.labelSource).toBe('user');
});

it('route: viewer cannot create a category (403)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/categories`,
    headers: { cookie: viewerCookie },
    payload: { name: 'Nope' },
  });
  expect(res.statusCode).toBe(403);
});

it('route: duplicate slug → 409', async () => {
  await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/categories`,
    headers: { cookie: adminCookie },
    payload: { name: 'X', slug: 'dupe' },
  });
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/categories`,
    headers: { cookie: adminCookie },
    payload: { name: 'Y', slug: 'dupe' },
  });
  expect(res.statusCode).toBe(409);
});

it('route: rename + delete a stream', async () => {
  const cat = (
    await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/categories`,
      headers: { cookie: adminCookie },
      payload: { name: 'Cat7' },
    })
  ).json().category;
  const stm = (
    await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/categories/${cat.id}/streams`,
      headers: { cookie: adminCookie },
      payload: { name: 'S7' },
    })
  ).json().stream;
  const ren = await app.inject({
    method: 'PATCH',
    url: `/api/v1/workspaces/${workspaceId}/streams/${stm.id}`,
    headers: { cookie: adminCookie },
    payload: { name: 'Renamed' },
  });
  expect(ren.json().stream.name).toBe('Renamed');
  const del = await app.inject({
    method: 'DELETE',
    url: `/api/v1/workspaces/${workspaceId}/streams/${stm.id}`,
    headers: { cookie: adminCookie },
  });
  expect(del.statusCode).toBe(204);
});

it('route: stream agent-instructions pins both slugs (admin only)', async () => {
  const cat = (
    await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/categories`,
      headers: { cookie: adminCookie },
      payload: { name: 'Infra', slug: 'infra' },
    })
  ).json().category;
  const stm = (
    await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/categories/${cat.id}/streams`,
      headers: { cookie: adminCookie },
      payload: { name: 'Health', slug: 'system-health' },
    })
  ).json().stream;
  // Need a source to mint a token against.
  const src = (
    await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/sources`,
      headers: { cookie: adminCookie },
      payload: { name: 'Bot' },
    })
  ).json().source;

  const ok = await app.inject({
    method: 'GET',
    url: `/api/v1/workspaces/${workspaceId}/streams/${stm.id}/agent-instructions?sourceId=${src.id}`,
    headers: { cookie: adminCookie },
  });
  expect(ok.statusCode).toBe(200);
  expect(ok.json().setupPrompt).toContain('"slug": "system-health"');
  expect(typeof ok.json().registrationToken).toBe('string');

  // Editor lacks sources:manage → 403.
  const denied = await app.inject({
    method: 'GET',
    url: `/api/v1/workspaces/${workspaceId}/streams/${stm.id}/agent-instructions?sourceId=${src.id}`,
    headers: { cookie: editorCookie },
  });
  expect(denied.statusCode).toBe(403);
});
```

Ensure `viewerCookie` exists in the harness — add a viewer member alongside the editor in `beforeAll` (mirror the editor invite/accept block, role `viewer`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @pulsedeck/api test -- structure`
Expected: FAIL — routes 404 / not registered.

- [ ] **Step 3: Implement the routes**

Create `apps/api/src/routes/structure.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { makeRequireAuth, makeRequireWorkspaceRole } from '../auth/fastify.js';
import { categories, sources, streams, type Source } from '../db/index.js';
import {
  createCategory,
  createStream,
  deleteCategory,
  deleteStream,
  renameCategory,
  renameStream,
  reorderCategories,
  reorderStreams,
  type StructureError,
} from '../services/structure.js';
import { buildDestinationSetupPrompt, reissueRegistrationToken } from '../services/sources.js';
import { getSchemaInfo } from '@pulsedeck/schema';

const NameBody = z.object({ name: z.string().min(1).max(120) });
const CreateCategoryBody = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80).optional(),
  position: z.number().int().min(0).optional(),
});
const CreateStreamBody = CreateCategoryBody;
const RenameBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((b) => b.name !== undefined || b.position !== undefined, {
    message: 'No fields to update',
  });
const ReorderBody = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

const BASE_URL_PLACEHOLDER = 'https://your-pulsedeck-host.example';

function statusForError(e: StructureError): number {
  if (e === 'slug_exists') return 409;
  if (e === 'not_found') return 404;
  return 400; // bad_order
}

export async function structureRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const requireAuth = makeRequireAuth(app.auth);
  const manageCategories = [requireAuth, makeRequireWorkspaceRole(db, 'categories:create')];
  const manageStreams = [requireAuth, makeRequireWorkspaceRole(db, 'streams:create')];
  const manageSources = [requireAuth, makeRequireWorkspaceRole(db, 'sources:manage')];

  function resolveBaseUrl(): { baseUrl: string; isPlaceholder: boolean } {
    const configured = app.authEnv.BETTER_AUTH_URL;
    return configured
      ? { baseUrl: configured, isPlaceholder: false }
      : { baseUrl: BASE_URL_PLACEHOLDER, isPlaceholder: true };
  }

  async function loadWsSource(workspaceId: string, sourceId: string): Promise<Source | null> {
    const [s] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)))
      .limit(1);
    return s ?? null;
  }

  // --- Categories ---
  app.post(
    '/api/v1/workspaces/:id/categories',
    { preHandler: manageCategories },
    async (req, reply) => {
      const { id: workspaceId } = req.params as { id: string };
      const parsed = CreateCategoryBody.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
      const res = await createCategory(db, { workspaceId, ...parsed.data });
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.code(201).send({ category: res.category });
    },
  );

  app.patch(
    '/api/v1/workspaces/:id/categories/reorder',
    { preHandler: manageCategories },
    async (req, reply) => {
      const { id: workspaceId } = req.params as { id: string };
      const parsed = ReorderBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
      const res = await reorderCategories(db, workspaceId, parsed.data.ids);
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.send({ ok: true });
    },
  );

  app.patch(
    '/api/v1/workspaces/:id/categories/:categoryId',
    { preHandler: manageCategories },
    async (req, reply) => {
      const { id: workspaceId, categoryId } = req.params as { id: string; categoryId: string };
      const parsed = RenameBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
      // Only name is supported via this route; position changes go through reorder.
      if (parsed.data.name === undefined) return reply.code(400).send({ error: 'name required' });
      const res = await renameCategory(db, workspaceId, categoryId, parsed.data.name);
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.send({ category: res.category });
    },
  );

  app.delete(
    '/api/v1/workspaces/:id/categories/:categoryId',
    { preHandler: manageCategories },
    async (req, reply) => {
      const { id: workspaceId, categoryId } = req.params as { id: string; categoryId: string };
      const res = await deleteCategory(db, workspaceId, categoryId);
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.code(204).send();
    },
  );

  // --- Streams ---
  app.post(
    '/api/v1/workspaces/:id/categories/:categoryId/streams',
    { preHandler: manageStreams },
    async (req, reply) => {
      const { id: workspaceId, categoryId } = req.params as { id: string; categoryId: string };
      const parsed = CreateStreamBody.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
      const res = await createStream(db, { workspaceId, categoryId, ...parsed.data });
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.code(201).send({ stream: res.stream });
    },
  );

  app.patch(
    '/api/v1/workspaces/:id/categories/:categoryId/streams/reorder',
    { preHandler: manageStreams },
    async (req, reply) => {
      const { id: workspaceId, categoryId } = req.params as { id: string; categoryId: string };
      const parsed = ReorderBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
      const res = await reorderStreams(db, workspaceId, categoryId, parsed.data.ids);
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.send({ ok: true });
    },
  );

  app.patch(
    '/api/v1/workspaces/:id/streams/:streamId',
    { preHandler: manageStreams },
    async (req, reply) => {
      const { id: workspaceId, streamId } = req.params as { id: string; streamId: string };
      const parsed = RenameBody.safeParse(req.body);
      if (!parsed.success || parsed.data.name === undefined)
        return reply.code(400).send({ error: 'name required' });
      const res = await renameStream(db, workspaceId, streamId, parsed.data.name);
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.send({ stream: res.stream });
    },
  );

  app.delete(
    '/api/v1/workspaces/:id/streams/:streamId',
    { preHandler: manageStreams },
    async (req, reply) => {
      const { id: workspaceId, streamId } = req.params as { id: string; streamId: string };
      const res = await deleteStream(db, workspaceId, streamId);
      if ('error' in res) return reply.code(statusForError(res.error)).send({ error: res.error });
      return reply.code(204).send();
    },
  );

  // --- Agent instructions (sources:manage — token-bearing) ---
  const InstrQuery = z.object({ sourceId: z.string().min(1) });

  app.get(
    '/api/v1/workspaces/:id/streams/:streamId/agent-instructions',
    { preHandler: manageSources },
    async (req, reply) => {
      const { id: workspaceId, streamId } = req.params as { id: string; streamId: string };
      const q = InstrQuery.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: 'sourceId required' });
      // Resolve stream + its category slug, scoped to workspace.
      const [row] = await db
        .select({ streamSlug: streams.slug, categorySlug: categories.slug })
        .from(streams)
        .innerJoin(categories, eq(categories.id, streams.categoryId))
        .where(and(eq(streams.id, streamId), eq(categories.workspaceId, workspaceId)))
        .limit(1);
      if (!row) return reply.code(404).send({ error: 'Stream not found' });
      const source = await loadWsSource(workspaceId, q.data.sourceId);
      if (!source) return reply.code(404).send({ error: 'Source not found' });

      const { baseUrl, isPlaceholder } = resolveBaseUrl();
      const regToken = await reissueRegistrationToken(db, source.id, req.user!.id);
      return reply.send({
        registrationToken: regToken,
        setupPrompt: buildDestinationSetupPrompt(baseUrl, regToken, {
          categorySlug: row.categorySlug,
          streamSlug: row.streamSlug,
        }),
        schema: getSchemaInfo(),
        ...(isPlaceholder
          ? {
              baseUrlNote:
                'BETTER_AUTH_URL is not configured; the prompt uses a placeholder base URL. Set it and re-generate.',
            }
          : {}),
      });
    },
  );

  app.get(
    '/api/v1/workspaces/:id/categories/:categoryId/agent-instructions',
    { preHandler: manageSources },
    async (req, reply) => {
      const { id: workspaceId, categoryId } = req.params as { id: string; categoryId: string };
      const q = InstrQuery.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: 'sourceId required' });
      const [cat] = await db
        .select({ slug: categories.slug })
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.workspaceId, workspaceId)))
        .limit(1);
      if (!cat) return reply.code(404).send({ error: 'Category not found' });
      const source = await loadWsSource(workspaceId, q.data.sourceId);
      if (!source) return reply.code(404).send({ error: 'Source not found' });

      const { baseUrl, isPlaceholder } = resolveBaseUrl();
      const regToken = await reissueRegistrationToken(db, source.id, req.user!.id);
      return reply.send({
        registrationToken: regToken,
        setupPrompt: buildDestinationSetupPrompt(baseUrl, regToken, { categorySlug: cat.slug }),
        schema: getSchemaInfo(),
        ...(isPlaceholder
          ? {
              baseUrlNote:
                'BETTER_AUTH_URL is not configured; the prompt uses a placeholder base URL. Set it and re-generate.',
            }
          : {}),
      });
    },
  );
}
```

> NOTE: register the `/reorder` routes BEFORE the `/:categoryId` and `/:streamId` param routes so Fastify's router matches the literal segment first (as written above). Verify there is no conflict.

- [ ] **Step 4: Register the routes**

Find where `sourceRoutes` is registered in `apps/api/src/server.ts` and add `structureRoutes` next to it (same registration style — `await app.register(structureRoutes)` or `structureRoutes(app)`, matching the existing call). Add the import.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @pulsedeck/api test -- structure`
Expected: ALL structure tests PASS (including the route test from Task 3).

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm --filter @pulsedeck/api typecheck && pnpm --filter @pulsedeck/api lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/structure.ts apps/api/src/server.ts apps/api/test/structure.integration.test.ts
git commit -m "feat(api): category/stream management + agent-instructions routes"
```

---

## Task 8: Web API client + data hooks

**Files:**

- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/hooks/use-workspace-data.ts`

- [ ] **Step 1: Add `labelSource` to tree types + client methods**

In `apps/web/src/lib/api.ts`: locate the tree response types (`TreeCategory`/`TreeStream` or inline) and add `labelSource: 'auto' | 'user'` to both. Add client methods mirroring the existing fetch-wrapper style used for sources:

```ts
createCategory(wsId: string, body: { name: string; slug?: string }): Promise<{ category: TreeCategory }>
renameCategory(wsId: string, id: string, name: string): Promise<{ category: TreeCategory }>
deleteCategory(wsId: string, id: string): Promise<void>
reorderCategories(wsId: string, ids: string[]): Promise<void>
createStream(wsId: string, categoryId: string, body: { name: string; slug?: string }): Promise<{ stream: TreeStream }>
renameStream(wsId: string, id: string, name: string): Promise<{ stream: TreeStream }>
deleteStream(wsId: string, id: string): Promise<void>
reorderStreams(wsId: string, categoryId: string, ids: string[]): Promise<void>
streamInstructions(wsId: string, streamId: string, sourceId: string): Promise<InstructionsResponse>
categoryInstructions(wsId: string, categoryId: string, sourceId: string): Promise<InstructionsResponse>
```

Define `InstructionsResponse = { registrationToken: string; setupPrompt: string; baseUrlNote?: string }`. Map verbs/paths to Task 7's routes. Reuse the existing request helper (the one sources methods use) so auth + error handling are consistent.

- [ ] **Step 2: Add mutations + instructions query to the hook**

In `apps/web/src/hooks/use-workspace-data.ts`, add a `useStructureMutations(wsId)` hook returning create/rename/delete/reorder mutations (TanStack Query `useMutation`), each calling `queryClient.invalidateQueries({ queryKey: ['tree', wsId] })` on success (match the existing tree query key — find it in `useTree`). Add a `useAgentInstructions` helper that fetches on demand (a mutation, not a query, since it mints a token each call).

- [ ] **Step 3: Typecheck web**

Run: `pnpm --filter @pulsedeck/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/hooks/use-workspace-data.ts
git commit -m "feat(web): structure api client + mutations"
```

---

## Task 9: Structure dialogs (create / rename / delete confirm)

**Files:**

- Create: `apps/web/src/components/structure/structure-dialogs.tsx`

- [ ] **Step 1: Build the dialogs**

Model on `apps/web/src/components/dashboard/dashboard-dialogs.tsx` (same Radix Dialog primitives + form patterns). Export:

- `CategoryDialog`: props `{ open, onOpenChange, mode: 'create' | 'rename', initialName?, onSubmit: (name: string) => Promise<void> }`. Create mode shows a name field and a read-only preview of the derived slug (compute client-side with a local `slugify` mirroring the server: lowercase, non-alphanumerics → `-`, trim) with hint "Slug is permanent." Rename mode shows only the name field.
- `StreamDialog`: identical shape; used under a chosen category.
- `DeleteStructureDialog`: props `{ open, onOpenChange, kind: 'category' | 'stream', name, impact?: { streams?: number; reports: number }, onConfirm: () => Promise<void> }`. Renders blast radius text ("Deletes “Infra” and its N streams / M reports. This cannot be undone.") and a destructive confirm button.

Keep these presentational — they call the `onSubmit`/`onConfirm` passed in (wired in Task 10). Local `slugify` lives here (or in `apps/web/src/lib/utils.ts` if a slug helper already exists — check first and reuse).

- [ ] **Step 2: Typecheck web**

Run: `pnpm --filter @pulsedeck/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/structure/structure-dialogs.tsx
git commit -m "feat(web): category/stream create, rename, delete dialogs"
```

---

## Task 10: Sidebar inline controls + auto-named badge + actionable empty state

**Files:**

- Modify: `apps/web/src/components/app-shell/sidebar.tsx`

- [ ] **Step 1: Add a permission helper**

In `apps/web/src/lib/workspace-context.ts` (where `canBuildDashboards` lives), add `canManageStructure(role)` = `['owner','admin','editor'].includes(role)` and `canManageSources(role)` = `['owner','admin'].includes(role)` (reuse an existing source-manage helper if one already exists — grep first).

- [ ] **Step 2: Wire controls into the Streams section**

In `sidebar.tsx`:

- Import the dialogs + `useStructureMutations` + the instructions dialog (Task 11).
- Add `[+]` to the "Streams" header (visible when `canManageStructure(role)`) → opens `CategoryDialog` in create mode; on submit call the create-category mutation + toast.
- On each category row: a hover-revealed `⋯` menu (use the existing dropdown-menu UI primitive in `components/ui` — grep for `dropdown-menu`) with: New stream, Rename, Copy agent instructions (only when `canManageSources(role)`), Delete.
- On each stream row: `⋯` menu with Rename, Copy agent instructions (gated), Delete.
- Render a faint badge/dot next to any category/stream where `labelSource === 'auto'` (title="Auto-named — rename to customize").
- Replace the empty state: when `canManageStructure(role)`, show "No categories yet" + a "Create category" button; otherwise keep "they appear as agents push reports."

Keep the read-only tree intact for users without `canManageStructure`.

- [ ] **Step 3: Manual smoke + typecheck**

Run: `pnpm --filter @pulsedeck/web typecheck`
Expected: PASS. Then start the app (`docker compose` per project memory) and confirm: create category, add stream, rename, delete confirm, badge appears for agent-created entries.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/app-shell/sidebar.tsx apps/web/src/lib/workspace-context.ts
git commit -m "feat(web): inline category/stream management in sidebar"
```

---

## Task 11: Agent instructions dialog (source picker + copy)

**Files:**

- Create: `apps/web/src/components/structure/agent-instructions-dialog.tsx`

- [ ] **Step 1: Build the dialog**

Props: `{ open, onOpenChange, target: { kind: 'category' | 'stream'; id: string; name: string }, wsId }`.

- Fetch the workspace's sources (reuse the existing sources query/hook used by the Sources page — grep `useSources`).
- Render a source `<select>` plus a "New source" affordance that opens the existing create-source flow (reuse the Sources page's create dialog/component; if not extractable, link to `/w/$ws/sources` with a hint). Persist nothing — picking a source just drives the fetch.
- On source pick (and on "Regenerate"), call the instructions mutation (`streamInstructions`/`categoryInstructions`). Show the returned `setupPrompt` in a read-only code box with a "Copy" button (reuse the copy-prompt UI/component from the Sources page — grep the sources page for the setup-prompt copy block and reuse it).
- If `baseUrlNote` is present, show it as a warning banner.
- Note "Token expires in 24h" under the prompt.

- [ ] **Step 2: Typecheck web**

Run: `pnpm --filter @pulsedeck/web typecheck`
Expected: PASS.

- [ ] **Step 3: Wire into sidebar menus**

In `sidebar.tsx`, make the "Copy agent instructions" menu items open this dialog with the right `target`.

- [ ] **Step 4: Manual smoke**

Start app; on a stream, "Copy agent instructions" → pick a source → prompt shows with `system-health` slug filled → Copy works.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/structure/agent-instructions-dialog.tsx apps/web/src/components/app-shell/sidebar.tsx
git commit -m "feat(web): copyable destination-scoped agent instructions"
```

---

## Task 12: Drag-reorder

**Files:**

- Modify: `apps/web/src/components/app-shell/sidebar.tsx`
- Possibly modify: `apps/web/package.json` (only if a dnd lib must be added)

- [ ] **Step 1: Choose the dnd approach**

Run: `grep -i "dnd\|dndkit\|sortable\|react-dnd" apps/web/package.json`

- If `@dnd-kit/*` is present, use it. Otherwise use native HTML5 drag-and-drop (`draggable`, `onDragStart/Over/Drop`) to avoid a new dependency — sidebar reorder is simple enough. Decide and note which.

- [ ] **Step 2: Implement category reordering**

Make category groups draggable. On drop, compute the new ordered id array and call the reorder-categories mutation (optimistic update of the tree cache, rollback on error). Only enabled when `canManageStructure(role)`.

- [ ] **Step 3: Implement stream reordering within a category**

Same within each category's stream list → reorder-streams mutation with that `categoryId`.

- [ ] **Step 4: Typecheck + smoke**

Run: `pnpm --filter @pulsedeck/web typecheck`
Expected: PASS. Smoke: drag a category and a stream; order persists across reload.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/app-shell/sidebar.tsx apps/web/package.json
git commit -m "feat(web): drag-reorder categories and streams"
```

---

## Task 13: E2E smoke

**Files:**

- Create: `apps/e2e/tests/manual-setup.spec.ts`

- [ ] **Step 1: Write the E2E test**

Model on existing specs in `apps/e2e/tests`. Flow: log in as admin → create a category "Infra" → add stream "System Health" → rename it → open "Copy agent instructions", pick a source, assert the prompt textbox contains `system-health` → (optional, if the harness exposes an ingest helper) simulate an agent push to `infra`/`system-health` and assert the report appears under the operator's label.

- [ ] **Step 2: Run E2E**

Run: `pnpm --filter @pulsedeck/e2e test` (per the e2e package's script — check `apps/e2e/package.json`).
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/manual-setup.spec.ts
git commit -m "test(e2e): manual setup + agent instruction flow"
```

---

## Final verification

- [ ] `pnpm --filter @pulsedeck/api test` — all API tests pass.
- [ ] `pnpm --filter @pulsedeck/api typecheck && pnpm --filter @pulsedeck/web typecheck` — clean.
- [ ] `pnpm --filter @pulsedeck/api lint && pnpm --filter @pulsedeck/web lint` — clean.
- [ ] Manual: agent push to a manually-renamed stream keeps the operator's label (provenance invariant).
- [ ] Open PR from `feat/manual-setup` → `main`.
