# PulseDeck v1 — Phase-by-Phase Implementation Plan

Target: demo-able v1 in ~3–4 months, solo full-time. Build order is dependency-driven: the **schema contract** is laid first (it is the spine both backend and frontend hang off), then storage, then auth, then the ingestion core, then read/render, then dashboards, then optional realtime, then ops + launch polish.

Each phase lists: **Goal**, **Deliverables**, **Key tasks**, **Exit criteria** (definition of done). Phases are mostly sequential; a few can overlap (noted). Ship behind the auto-Overview fallback if the schedule tightens — the grid builder (Phase 9) is the cut line. A dedicated design phase (Phase 7) sets the visual system; design quality is a floor in every UI phase, not an afterthought.

Legend: `[api]` backend, `[web]` frontend, `[pkg]` shared package, `[ops]` infra.

---

## Phase 0 — Repo Foundation & Scaffolding

**Goal:** one-command dev loop and the empty monorepo skeleton that every later phase fills in.

**Deliverables**
- pnpm workspace monorepo: `apps/api`, `apps/web`, `packages/schema`, (`packages/sdk` stub for v1.1).
- Shared TS config, ESLint/Prettier, `.editorconfig`.
- Docker Compose skeleton: `postgres:16` + placeholder `api`/`web` services. Redis present but behind `profiles: ["realtime"]` (does not boot by default).
- `/healthz` endpoint returning 200 + db ping.
- Migration runner that executes on API startup.
- CI: typecheck + lint + test on push.

**Key tasks**
- `[ops]` pnpm workspaces, root scripts (`dev`, `build`, `test`, `lint`).
- `[api]` Fastify boot, env loader (validate required env at startup, fail fast), `/healthz`.
- `[ops]` `docker-compose.yml` per PRD (postgres volume, redis under profile, no required services beyond Postgres).
- `[ops]` GitHub Actions pipeline.

**Exit criteria:** `docker compose up` boots Postgres + API; `GET /healthz` is green; `pnpm dev` runs api + web; CI passes on a trivial PR.

---

## Phase 1 — Schema Package (the wire contract)

**Goal:** single source of truth for blocks, enums, report envelope, and limits. Everything downstream imports this. Build it first so backend validation and frontend rendering never drift.

**Deliverables (`packages/schema`)**
- Canonical enums: `severity`, `status`, `trend`, `sentiment`, `format`, `chart_variant`, `column_type`.
- Common block envelope (`id`, `type`, `title?`, `caption?`).
- All 8 block Zod schemas: metric, markdown, chart, table, timeline, alert, status, artifact (per `BLOCK_SCHEMA.md`).
- Report envelope schema (`version`, `source`, `category`, `stream`, `report{...}`, `blocks[]`).
- Ingestion limits enforced in schema: ≤50 blocks, ≤1000 rows, ≤20 cols, ≤10 series, ≤500 pts/series, ≤50k md chars, ≤1 MB payload.
- Cross-field validators: chart `series[].data` length == `labels` length; table row keys ⊆ column keys.
- Exported TS types + a `SCHEMA_VERSION = "1.0"` constant.
- Validation → structured `issues[]` mapper (Zod error → `{ path, message }`).

**Key tasks**
- `[pkg]` Author Zod schemas with discriminated union on `type`.
- `[pkg]` Unit tests: every block valid/invalid case, every limit boundary, the `issues[]` shape.
- `[pkg]` Helper to serialize the live schema for `GET /api/v1/schema` + agent setup prompt.

**Exit criteria:** schema package published to workspace, 100% block-type test coverage, the canonical report example from the PRD validates, and a malformed payload yields the exact PRD-shaped `issues[]`.

---

## Phase 2 — Data Model & Migrations

**Goal:** all persistence in place before any feature touches the DB.

**Deliverables (Drizzle)**
- Tables: `users`, `workspaces`, `workspace_members`, `sources`, `source_categories`, `source_streams`, `categories`, `streams`, `reports`, `report_metrics`, `dashboards` (per PRD Data Model).
- `reports.blocks` as JSONB; `reports.search_vector` generated `tsvector` (title + summary + tags) with GIN index.
- Unique constraint `(source_id, idempotency_key)`.
- Indexes: `reports(stream_id, occurred_at)`, `report_metrics(stream_id, key, occurred_at)`, FK indexes.
- Server timestamps `received_at`/`created_at`; agent-supplied `occurred_at` distinct.

**Key tasks**
- `[api]` Drizzle table definitions + relations.
- `[api]` Migration set; wire into Phase 0 startup runner.
- `[api]` Seed/fixtures helper for tests.

**Exit criteria:** migrations apply cleanly from empty DB on startup; tsvector + GIN index live; rollback path documented. Can overlap with Phase 1 tail.

---

## Phase 3 — Auth, Workspaces, RBAC & Onboarding

**Goal:** a human can install, become admin, create a workspace, invite teammates with roles.

**Deliverables**
- `[api]` better-auth: email/password + sessions. GitHub OAuth opt-in (only if `GITHUB_CLIENT_ID`/`SECRET` set — button hidden otherwise).
- First-run `/setup` wizard: zero-users state redirects all routes to `/setup`; creates admin; permanently disables `/setup`.
- Headless bootstrap: `BOOTSTRAP_EMAIL` + `BOOTSTRAP_PASSWORD` seed admin on startup, skip wizard.
- Workspaces CRUD + slug; `workspace_members` with 4 roles (Owner/Admin/Editor/Viewer).
- Invite links per role; accept-invite flow.
- RBAC middleware enforcing the PRD permission matrix (workspace-level).

**Key tasks**
- `[api]` Auth routes + session guard; RBAC policy helper (`can(user, action, workspace)`).
- `[web]` Login, `/setup` wizard, workspace switcher, members/invite settings UI (minimal).
- `[api]` Tests: each role × each gated action; setup-disabled-after-first-admin; bootstrap path.

**Exit criteria:** fresh install → `/setup` → admin created → workspace created → invite a Viewer → Viewer can read but not create. GitHub button appears only when configured.

---

## Phase 4 — Source Registration & Management

**Goal:** an agent can be registered and authenticated; admins manage keys and scope.

**Deliverables**
- `[api]` Admin creates Source → one-time `reg_xxxxx` invite token (24h expiry).
- `[api]` `POST /api/v1/sources/register` (X-Registration-Token) → `{ source_id, api_key (pd_...), schema }`; token invalidated immediately.
- `[api]` API key storage as hash only; bearer-token auth middleware for ingestion.
- `[api]` Write scope: `workspace` (default) | `category` | `stream`; `source_categories`/`source_streams` join rows; `allow_stream_autocreate` flag.
- `[api]` Key revoke + rotate; `last_seen_at` tracking.
- `[web]` Source management page: create source, copyable agent setup prompt (templated with BASE_URL + token + embedded schema), connected-agents list (last-seen, schema version, report count, health: active/stale/never).

**Key tasks**
- `[api]` Token generation + single-use semantics (atomic invalidate).
- `[api]` Setup-prompt template renderer (the PRD copy-paste block).
- `[api]` Tests: register happy path, token reuse rejected, expired token, key rotation invalidates old key (401).

**Exit criteria:** admin creates a source, copies the prompt, a curl-simulated agent registers, receives a working `pd_` key, and the dashboard shows it as "active." Reusing the reg token fails.

---

## Phase 5 — Ingestion API (the core)

**Goal:** the heart of the product — agents push reports, get crisp acceptance or correction. Highest-risk phase; budget extra time.

**Deliverables**
- `[api]` `POST /api/v1/reports` (Bearer + `Idempotency-Key`): validate against `packages/schema`.
- Status-code contract per PRD:
  - `200/201` accepted (idempotent replay returns original result).
  - `422` validation failed → `{ error, issues[], schema_version }`.
  - `401` invalid/revoked key.
  - `403` push outside source scope.
  - `409` unknown category/stream slug when autocreate off.
  - `429` rate limited (`@fastify/rate-limit`, per-source).
  - `5xx` safe to retry (idempotency dedup).
- Idempotent dedup on `(source_id, idempotency_key)`.
- Payload cap (1 MB) + all ingestion limits enforced → 422.
- Category/stream resolution: auto-create when allowed (respect RBAC/scope), else 409.
- `report_metrics` extraction: denormalize `metric` blocks at ingest.
- Emit in-process ingestion event (the seam SSE + future webhooks attach to).
- `GET /api/v1/schema` (version + live schema).

**Key tasks**
- `[api]` Ingestion pipeline: auth → scope check → validate → resolve slugs → idempotency check → insert (reports + report_metrics in one tx) → emit event.
- `[api]` Rate-limit config keyed per source.
- `[api]` Integration tests for every status code, idempotent replay, scope violations, autocreate on/off, limit boundaries, metric extraction correctness.

**Exit criteria:** the canonical PRD report ingests → 201; replay with same key → original result, no dupe; bad block → 422 with correct path; out-of-scope push → 403; over-limit payload → 422. `report_metrics` rows populated.

---

## Phase 6 — Report Read APIs & Search

**Goal:** everything the frontend needs to list, open, navigate, filter, and search reports.

**Deliverables**
- `[api]` Stream report list (chronological, paginated/cursor, filterable).
- `[api]` Workspace-wide "All Reports" list (same shape).
- `[api]` Report detail by id (blocks + metadata + prev/next within stream).
- `[api]` Category → stream tree (auto-generated from data) for sidebar.
- `[api]` Filters: category, stream, source, severity, tags, date range.
- `[api]` Full-text search over `search_vector` (tsvector GIN) — no external service.
- `[api]` Connected-agents/status endpoint (feeds Phase 4 UI).

**Key tasks**
- `[api]` Query builders with cursor pagination; combine filters + FTS in one query.
- `[api]` Tests: pagination stability, filter combinations, FTS ranking, prev/next edges.

**Exit criteria:** can fetch a stream's reports paginated, open one by permalink id with working prev/next, search by keyword, and filter by severity+tag+date. Can overlap with Phase 7 frontend.

---

## Phase 7 — Design System & UI Foundation

**Goal:** lock the visual identity and a themed component layer *before* building screens, so every later UI phase composes from one consistent, good-looking system instead of styling ad hoc. Identity: **calm instrument panel meets editorial briefing** — machine-precise data on a quiet human surface. Signal over noise (the same thing the product sells).

**Design direction (the token system — source of truth):**

*Color* — brand kept deliberately **outside** the semantic palette so domain status never reads ambiguous:
- **Pulse / brand** `#6E56CF` iris-violet — live state, focus rings, active source, the signature. Used with restraint. Dark-mode lift `#7C6BF0`.
- *Semantic (fixed to domain enums):* severity info `#3B82F6` · warning `#F59E0B` · critical `#EF4444`; status healthy `#10B981` · degraded `#F59E0B` · down `#EF4444` · unknown `#9CA3AF`; sentiment positive `#10B981` · negative `#EF4444` · neutral `#9CA3AF`.
- *Neutrals (light):* bg `#FBFBFC` · surface `#FFFFFF` · border `#E7E7EB` · ink `#0C0E14` · muted `#6B7280`.
- *Neutrals (dark, first-class):* bg `#0B0D12` · surface `#13161D` · border `#222630` · ink `#E8EAF0` · muted `#8A90A0`.

*Type* — two roles, both Geist (precise grotesque, product-grade):
- **Geist Sans** — UI + body; tabular figures for all metrics/tables; display weight for big metric values.
- **Geist Mono** — machine identifiers only: source ids (`src_…`), api keys (`pd_…`), metric `key`s, ISO timestamps, idempotency keys. Mono on machine-stuff reinforces the agent-generated identity (domain-true, not decoration).
- Compact dashboard scale (12/13/14 base). Define the full scale + weights once as tokens.

*Layout* — left sidebar (fixed items + auto category/stream tree) + main column. Hairline borders, consistent 6px radius, whitespace as the calm. Briefing density, never a data-dump.

*Signature* — **the pulse line**: a hairline ECG/sparkline of report cadence in the header/Overview, plus a live-pulse dot on active sources. One memorable element; everything else stays quiet. Honors `prefers-reduced-motion` (renders static when off).

**Deliverables**
- `[web]` ShadCN initialized, its CSS variables **rethemed** to the tokens above (not default zinc); semantic tokens layered on top (`--severity-warning`, `--status-down`, `--sentiment-negative`, …) so block renderers read meaning, not raw hex.
- `[web]` Light + dark themes wired (CSS vars + class toggle); persisted per user.
- `[web]` Geist Sans + Geist Mono self-hosted (no FOUT); tabular-figures utility.
- `[web]` Core primitives styled + documented: buttons, inputs, select, dialog, dropdown, badge/pill (severity + status variants), card, table, tabs, toast, skeleton/loading, empty-state.
- `[web]` App shell: sidebar + topbar + content frame, responsive to mobile, visible keyboard focus (brand ring).
- `[web]` The signature pulse-line component (reduced-motion aware).
- `[web]` A `/design` kitchen-sink route rendering every primitive + both themes for visual review.

**Key tasks**
- `[web]` Token file (CSS vars) + Tailwind theme mapping; map domain enums → semantic tokens in one place.
- `[web]` Build/borrow ShadCN primitives, restyle to tokens, verify contrast (WCAG AA) in both themes.
- `[web]` Screenshot the kitchen-sink, self-critique against the brief, cut one accessory.

**Exit criteria:** `/design` route shows every primitive in light + dark, severity/status/sentiment colors are unambiguous and AA-contrast, mono renders on machine ids, the pulse-line animates (and freezes under reduced-motion), keyboard focus is visible everywhere. No screen-building starts until this passes.

---

## Phase 8 — Frontend App & Report Viewer

**Goal:** the human-facing surface — render all 8 blocks, browse streams, read reports. Composes entirely from the Phase 7 system.

**Deliverables**
- `[web]` Vite + React + TanStack Router (type-safe routes) + TanStack Query (cache + polling fallback) on the Phase 7 shell.
- `[web]` Block renderers (driven by `packages/schema` types):
  - metric (trend arrow = geometry, sentiment = color; delta + comparison_label; format/precision).
  - markdown (react-markdown, `skipHtml`, no `rehype-raw`).
  - chart (Recharts line/bar/area; ISO label handling).
  - table (typed columns, real-type sort, safe column order).
  - timeline, alert (severity styling), status grid, artifact (`rel="noopener noreferrer" target="_blank"`, never fetched server-side).
- `[web]` Report detail page `/w/:ws/r/:reportId`: flat sequential blocks + metadata + prev/next.
- `[web]` Stream list view + "All Reports" view (shared component).
- `[web]` Sidebar: fixed items (Overview/Activity, Search, Sources, Settings) + auto category→stream tree.
- `[web]` Search UI + filter controls wired to Phase 6.

**Key tasks**
- `[web]` Shared block-renderer registry keyed by `type` (mirrors schema union).
- `[web]` Per-user timezone display (UTC storage → local render).
- `[web]` Renderer tests + a visual fixture report exercising all 8 blocks.

**Exit criteria:** open a report containing all 8 block types and every one renders correctly; markdown XSS attempt is neutralized; table sorts on real types; navigate streams via sidebar; search returns results.

---

## Phase 9 — Dashboards & Grid Builder

**Goal:** user-curated dashboard pages. Heaviest UI item — the schedule cut line. Until built, the system "Overview" is the landing view so nothing is blank.

**Deliverables**
- `[web]` 12-column responsive grid builder; widget column span (full/half/third); row reorder.
- Widget types: Stream Feed (latest N), Metric Widget (latest value by `key`), Chart Widget (time-series of a metric across reports), Report Count (volume over time), Alert Feed (recent alerts in a category).
- Each widget configures source stream/category + display options.
- `[api]` Dashboard CRUD; `layout` JSONB; multi-dashboard per workspace; `is_default`; `position` ordering.
- `[web]` System "Overview" fallback (recent reports + connected agents) when no custom dashboards exist.
- Widgets read from `report_metrics` (indexed) not JSONB scans.

**Key tasks**
- `[api]` Dashboard persistence + metric/chart widget query endpoints (off `report_metrics`).
- `[web]` Grid layout component, widget config panels, default-dashboard selection.
- `[web]` Tests: layout persistence, default landing, metric selection by `key`.

**Exit criteria:** build a dashboard with a metric + chart + stream feed widget, set it default, reload → it's the landing page; fresh workspace shows auto-Overview.

---

## Phase 10 — Realtime SSE (optional, never a blocker)

**Goal:** live updates as an enhancement. App must be fully usable with no Redis and no SSE.

**Deliverables**
- `[api]` Three auto-detected tiers (PRD §7):
  - Polling: no `REDIS_URL`, SSE off — client refetch on interval (already works via TanStack Query).
  - Single-instance SSE: in-process emitter → SSE clients (no Redis).
  - Multi-instance SSE: `REDIS_URL` set → Redis pub/sub fan-out across replicas.
- SSE endpoint fed by the Phase 5 ingestion event.
- `[web]` Live activity feed + report lists update without refresh when SSE on; graceful fallback to polling.

**Key tasks**
- `[api]` Event bus abstraction (in-process | redis) selected at boot from env.
- `[web]` SSE client with reconnect + fallback.
- `[api]` Tests: event emitted on ingest; multi-instance fan-out (Redis profile); polling-only still shows fresh data on refetch.

**Exit criteria:** with SSE on, a pushed report appears live; with Redis off it still works single-instance; with everything off, refresh shows new data. Booting without Redis never errors.

---

## Phase 11 — Retention & Ops Hardening

**Goal:** production-safe self-host defaults.

**Deliverables**
- `[api]` `RETENTION_DAYS` (default `0` = keep forever). App-side scheduled purge of reports beyond window, keyed on server `created_at` (never `occurred_at`).
- Purge job guarded by Postgres advisory lock (runs once across replicas); last-run status surfaced in UI/logs; testable.
- `/healthz` deep check; migrations-on-startup confirmed idempotent.
- Production Docker images for `api` + `web`; final `docker-compose.yml`.
- Per-source rate-limit + 1 MB cap verified end-to-end.

**Key tasks**
- `[api]` Scheduler (in-process) + advisory-lock wrapper; observable last-run.
- `[ops]` Multi-stage Dockerfiles; image build in CI.
- `[api]` Tests: purge respects window + server time; advisory lock prevents double-run; `RETENTION_DAYS=0` deletes nothing.

**Exit criteria:** set `RETENTION_DAYS=90`, old reports purge, recent retained, last-run visible; two API replicas purge exactly once; default install loses no data.

---

## Phase 12 — Demo Agent, One-Command Self-Host & Launch Polish

**Goal:** the "aha in under 2 minutes" and a launch-ready repo. Empty dashboards kill products — this phase prevents that.

**Deliverables**
- `[ops]` `npx pulsedeck-demo --url ... --token <invite>`: registers as a source, then pushes realistic fake reports (SEO audit, deploy summary, metric report) every ~30s using all block types.
- Verified one-command path: `docker compose up` → `localhost:3000` → `/setup` → demo agent → live filling dashboard.
- README with demo GIF, copy-paste setup prompt, quick-start.
- AGPL v3 license + CLA doc.
- Final pass on the copyable agent setup prompt page (zero-external-docs integration).

**Key tasks**
- `[ops]` Demo agent script (uses the real registration + ingestion APIs — dogfoods the protocol).
- `[ops]` README, demo GIF/video capture, LICENSE, CLA.
- End-to-end smoke test of the full first-user experience.

**Exit criteria:** a brand-new user, from zero, runs two commands and watches the dashboard fill with live realistic reports inside 2 minutes. Repo is public-launch ready.

---

## Sequencing Summary & Critical Path

```
0 Foundation
└─1 Schema ──┬─ 2 Data Model
             │
   3 Auth/RBAC/Onboarding  (after 2)
   4 Sources               (after 3)
   5 Ingestion CORE        (after 4) ◄── highest risk, critical path
   6 Read APIs + Search    (after 5)  ┐ overlap
   7 Design System & UI    (after 0, can start early) ◄── gates all screens
   8 Frontend + Viewer     (after 6 + 7)
   9 Dashboards            (after 8)  ◄── cut line if schedule tightens
  10 Realtime SSE          (after 5/8, optional)
  11 Retention + Ops       (after 5)
  12 Demo + Launch         (last)
```

**Critical path:** Schema → Data → Auth → Sources → **Ingestion** → Read → Viewer → Demo, with the Design System (7) feeding the Viewer in parallel. The grid builder (9) and SSE (10) are the two deferrable items — ship behind the auto-Overview + polling fallback if time runs short, without blocking launch.

**Design phase can start early:** Phase 7 only depends on Phase 0 (Vite/React shell) — it needs no backend. Build it in parallel with the API phases (3–6) so the visual system is ready the moment screen-building begins. It does *not* sit on the backend critical path.

**Risk-driven ordering rationale:**
- Schema first → backend/frontend never drift (PRD Risk 3).
- Ingestion is the product's heart and riskiest integration surface → built early with full status-code + idempotency test coverage.
- Demo agent + one-command self-host are explicit launch-blockers (Risks 4 & 5) → dedicated final phase, dogfooding the real protocol.

**Testing posture throughout:** schema package and ingestion API get the deepest coverage (validation, idempotency, scope, limits, status codes). Every phase exits only on its stated criteria.
```