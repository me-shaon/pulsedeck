# PulseDeck — Manual Setup of Categories & Streams + Easy Agent Instruction

> Design spec. Lets operators manually create/rename/reorder/delete categories
> and streams in the UI, and copy a paste-ready agent instruction (per category
> or per stream) that tells any AI agent exactly where to push reports. Keeps
> today's auto-create behaviour intact.

## Problem

Today categories and streams exist **only** because an agent pushed a report to
a new slug (`apps/api/src/services/ingestion.ts` → `resolveDestination` →
`titleFromSlug`). There is:

- **No UI/API to manually create, rename, reorder, or delete** categories/streams.
- **No way to copy a ready-to-use agent instruction** scoped to a chosen
  destination. The only setup prompt is per-source and uses placeholder slugs
  (`buildSetupPrompt`, `apps/api/src/services/sources.ts`).

The product's whole promise is "instruct an agent in one paste." Without manual
structure + a destination-aware instruction, the operator either lets agents
invent slugs or hand-edits the DB. Both fail the "easy" bar.

## Goals

1. Operators manage categories/streams from the sidebar tree (create, rename,
   reorder, delete).
2. Auto-create stays **ON** — agents can still mint new slugs. Manual and
   auto-created entries coexist.
3. **User-set labels win.** Renaming a category/stream never gets overwritten by
   later agent pushes.
4. A **"Copy agent instructions"** action on every category and stream produces a
   paste-ready prompt with the target slug(s) pre-filled and a live registration
   token, so an operator pastes it into Claude Code / Cursor / any agent and is
   done.

## Non-goals (YAGNI)

- No change to the 8 block types or wire contract.
- No per-stream source binding table — the instruction just _embeds_ slugs; the
  existing source `scope` (workspace/category/stream) still governs permission.
- No SDK-code / curl variants of the instruction in v1 (prompt only; we already
  decided to start with the agent prompt). Easy to add later off the same
  builder.
- No category/stream archival — delete is a hard cascade with confirm.

---

## Data model

### `label_source` provenance flag

Add to **both** `categories` and `streams`
(`apps/api/src/db/schema/categories.ts`, `streams.ts`):

```ts
labelSource: text('label_source', { enum: ['auto', 'user'] })
  .notNull()
  .default('auto'),
```

- `auto` — name was derived from the slug (`titleFromSlug`) at autocreate, or the
  operator never edited it.
- `user` — operator set/edited the name explicitly.

**Why it works without complex logic:** agents send **slug only**
(`category:{slug}`, `stream:{slug}` — verified in `packages/schema/src/report.ts`
and `ingestion.ts`). `titleFromSlug` runs **only at insert** inside
`createCategory`/`createStream`; later pushes match by slug and never touch
`name`. So a renamed label already survives. `label_source` makes the intent
explicit and powers a faint "auto-named" badge in the UI; it is also the guard
if the wire contract ever lets agents send a display name (ingestion would skip
the name on `label_source = 'user'`).

Migration: new Drizzle migration adding the column, default `'auto'`, backfill
existing rows to `'auto'`.

### Slug immutability

Slug is the routing key. Once a category/stream exists, **slug is immutable** via
the API (PATCH accepts `name`/`position` only). At manual-create time the
operator may set the slug (nothing depends on it yet); we derive a default slug
from the name and let them override.

---

## API

New routes in a new module `apps/api/src/routes/structure.ts` (registered like
the others), with logic in a new `apps/api/src/services/structure.ts`. RBAC
reuses **existing** actions (`apps/api/src/auth/rbac.ts`) — no new capability:

- Category CRUD + reorder → `categories:create` (owner/admin/editor).
- Stream CRUD + reorder → `streams:create` (owner/admin/editor).
- **agent-instructions** endpoints → `sources:manage` (owner/admin only), since
  they mint a registration token — same tier as source setup today.

Gate via `makeRequireWorkspaceRole(db, '<action>')` exactly like `sources.ts`.

```
POST   /api/v1/workspaces/:id/categories
       body: { name, slug?, position? }            → 201 { category }
PATCH  /api/v1/workspaces/:id/categories/:categoryId
       body: { name?, position? }                  → 200 { category }   (slug immutable)
DELETE /api/v1/workspaces/:id/categories/:categoryId → 204   (cascade streams+reports)

POST   /api/v1/workspaces/:id/categories/:categoryId/streams
       body: { name, slug?, position? }            → 201 { stream }
PATCH  /api/v1/workspaces/:id/streams/:streamId
       body: { name?, position? }                  → 200 { stream }
DELETE /api/v1/workspaces/:id/streams/:streamId    → 204   (cascade reports)

PATCH  /api/v1/workspaces/:id/categories/reorder
       body: { ids: string[] }                     → 200   (sets position by index)
PATCH  /api/v1/workspaces/:id/categories/:categoryId/streams/reorder
       body: { ids: string[] }                     → 200

GET    /api/v1/workspaces/:id/categories/:categoryId/agent-instructions?sourceId=...
GET    /api/v1/workspaces/:id/streams/:streamId/agent-instructions?sourceId=...
       → 201-style { setupPrompt, registrationToken, schema, baseUrlNote? }
```

Service behaviour:

- **Create**: `id('cat')` / `id('stm')`, `labelSource: 'user'`, derive slug from
  name if omitted (slugify), `position` defaults to max+1 within parent. Reuse
  the existing `ON CONFLICT DO NOTHING` + reselect pattern; on slug collision
  return `409 { error: 'slug_exists' }`.
- **PATCH name**: set `name`, set `labelSource: 'user'`. Verify ownership
  (category belongs to workspace; stream's category belongs to workspace — mirror
  `validateGrantOwnership` join in `services/sources.ts`).
- **DELETE**: relies on existing FK `onDelete: 'cascade'`. UI confirm states the
  blast radius (N streams, M reports).
- **Reorder**: single transaction, `position = index` for each id in the array;
  validate all ids belong to the parent scope.
- **agent-instructions**: load category/stream (404 if not in workspace), resolve
  `sourceId` (must belong to workspace; 400/404 otherwise), re-issue a
  registration token via existing `reissueRegistrationToken`, and render the
  **destination-aware** prompt (below).

### Ingestion — no behavioural change

`resolveDestination` stays as-is: autocreate ON, slug-match preserves existing
rows. Confirm in a test that an agent push to a **manually renamed** stream slug
keeps the user's label (`label_source` stays `'user'`, `name` unchanged).

---

## Agent instruction builder

Add `buildDestinationSetupPrompt(baseUrl, regToken, dest)` to
`apps/api/src/services/sources.ts` (sibling to `buildSetupPrompt`):

- `dest = { categorySlug }` (category-level) or `{ categorySlug, streamSlug }`
  (stream-level).
- Same 3-step structure as `buildSetupPrompt` (register → publish → handle
  responses), but **STEP 2's body has the slug(s) pre-filled**, not placeholders:
  - Stream-level: both `category.slug` and `stream.slug` fixed → "push every
    report here."
  - Category-level: `category.slug` fixed, `stream.slug` described as "choose/
    create a stream under this category" → reflects that autocreate is on.
- Keep the existing `BASE_URL_PLACEHOLDER` + `baseUrlNote` behaviour from
  `setupPayload` so self-host without `BETTER_AUTH_URL` still gets a usable
  prompt with a note.

The route returns `{ setupPrompt, registrationToken, schema, baseUrlNote? }`,
mirroring the existing `setupPayload` shape so the web reuses its copy UI.

---

## Web UI

### Sidebar tree (`apps/web/src/components/app-shell/sidebar.tsx`)

Today the tree is read-only and the empty state says "they appear as agents push
reports." Changes (gated on the manage capability — mirror `canBuildDashboards`
pattern with a `canManageStructure(role)` helper):

- **Streams header**: add a `[+]` button → "New category" dialog.
- **Per category row** (on hover / `⋯` menu): `+ stream`, Rename, Copy agent
  instructions, Delete.
- **Per stream row** (on hover / `⋯` menu): Rename, Copy agent instructions,
  Delete.
- **Auto-named badge**: categories/streams with `labelSource === 'auto'` show a
  faint dot/badge; renaming clears it.
- **Empty state**: becomes actionable — "No categories yet" + a "Create category"
  button (operators) alongside the existing "or let an agent push" hint.
- **Drag-reorder** (v1): drag categories to reorder, drag streams within a
  category to reorder. On drop, call the reorder endpoint with the new id order.
  Use a lightweight dnd approach consistent with the existing stack (e.g.
  `@dnd-kit` if already present; otherwise native HTML5 drag — confirm during
  planning, prefer the smallest dependency).

Non-managers see today's read-only tree (no controls).

### Tree endpoint shape

`GET /workspaces/:id/tree` (`services/reports-query.ts`) must include `slug` and
`labelSource` for categories and streams, and respect `position` ordering. Add
these fields; update the `useTree` type in the web data hooks.

### Dialogs / components (`apps/web/src/components/...`)

Follow the existing `CreateDashboardDialog` pattern
(`components/dashboard/dashboard-dialogs.tsx`):

- `CategoryDialog` (create/rename): name field; on create, an editable
  auto-derived slug with a "slug is permanent" hint.
- `StreamDialog` (create/rename): same, scoped to a category.
- `DeleteConfirmDialog`: shows blast radius, requires explicit confirm.
- `AgentInstructionsDialog`: source picker (existing sources + "New source"
  inline using the existing create-source flow), then renders the returned
  `setupPrompt` in a copy box (reuse the sources page's copy-prompt UI), with the
  `baseUrlNote` warning when present, and a "token expires in 24h / re-generate"
  affordance (re-calls the endpoint).

### Data hooks & API client

- `apps/web/src/lib/api.ts`: add typed methods for the new endpoints.
- `apps/web/src/hooks/use-workspace-data.ts` (or sibling): mutations for
  create/rename/delete/reorder that invalidate the `tree` query; a query/mutation
  for fetching agent instructions.

---

## Permissions

- Category/stream CRUD + reorder: `categories:create` / `streams:create`
  (owner/admin/editor) — existing RBAC actions.
- agent-instructions routes: `sources:manage` (owner/admin) — embeds a
  registration token.
- Viewers: read-only tree, no controls. Editors: CRUD/reorder but no instruction
  copy (token-bearing → owner/admin only).

---

## Testing

Backend (mirror existing route/service test style):

- Create category/stream: success, slug derivation, slug collision → 409,
  `labelSource = 'user'`.
- Rename: updates name + sets `labelSource = 'user'`; cross-workspace 404.
- Delete: cascades (stream count / report count gone), confirm 204.
- Reorder: positions set by index; rejects foreign ids.
- **Provenance invariant**: agent push to a renamed stream's slug keeps the
  user's name and `labelSource = 'user'`; autocreate of a brand-new slug yields
  `labelSource = 'auto'`.
- agent-instructions: stream-level prompt has both slugs filled; category-level
  has category slug filled + stream guidance; bad/foreign `sourceId` rejected;
  placeholder base URL yields `baseUrlNote`.

Web:

- Sidebar shows controls only for managers.
- Create/rename/delete/reorder flows invalidate and re-render the tree.
- Auto-named badge appears for `labelSource === 'auto'`, clears on rename.
- Instruction dialog copies a prompt containing the chosen slug(s).

E2E (`apps/e2e`): operator creates a category + stream, copies stream
instructions, and (smoke) a simulated agent push to that slug lands in the stream
with the operator's label preserved.

---

## Implementation order

1. **Migration + schema**: add `label_source` to categories/streams; backfill
   `'auto'`.
2. **Structure service + routes**: CRUD + reorder + ownership checks + tests.
3. **Tree endpoint**: expose `slug` + `labelSource`, honour `position`.
4. **Instruction builder + endpoints**: `buildDestinationSetupPrompt` + the two
   GET routes + tests.
5. **Web api client + hooks**: methods, mutations, query invalidation.
6. **Sidebar controls + dialogs**: create/rename/delete, auto-named badge,
   actionable empty state.
7. **Drag-reorder**: wire dnd → reorder endpoints.
8. **Agent instructions dialog**: source picker + copy box + regenerate.
9. **E2E** smoke.

Each step is independently shippable; nothing breaks existing auto-create.
