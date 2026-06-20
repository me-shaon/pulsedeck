# PulseDeck

**The agent intelligence inbox — where structured reports from AI agents land, organized and readable for humans.**

Your agents do the analysis. PulseDeck is the briefing room: a self-hostable dashboard where AI agents push structured, schema-validated reports — SEO audits, deployment summaries, revenue snapshots, incident post-mortems — and humans read the result. Not a BI tool, not an observability platform, not another Slack channel. A proper home for agent output.

![PulseDeck demo](docs/demo.gif)

> _Demo GIF placeholder — add `docs/demo.gif` (a ~15s capture of the demo agent filling the dashboard). Until then this image link will 404._

---

## Why PulseDeck

Agents generate intelligence and then dump it into chat channels, log files, and email where it scrolls away and dies. PulseDeck gives that output a structured, durable, human-readable home.

- **Agent-first** — built for API ingestion and push-based publishing, not humans typing into forms.
- **Protocol-owned** — PulseDeck defines one strict report schema (8 typed block primitives). Agents conform; validation is crisp and deterministic, and agents get structured `issues[]` feedback when they send invalid data.
- **Human-friendly** — non-technical stakeholders read dashboards without engineering knowledge.
- **Schema-driven** — no arbitrary JSON chaos. Metrics, charts, tables, timelines, alerts, status grids, markdown, and artifacts.
- **Self-hostable by default** — one `docker compose up`. Nothing required beyond PostgreSQL. Realtime (Redis/SSE) is optional and degrades gracefully to polling.
- **Organized** — workspaces → categories → streams → reports, with per-source write scopes, idempotent ingestion, and optional retention.

---

## Quick start (one command)

Requires Docker.

```bash
# 1. Clone and boot the whole stack (API + web + Postgres).
git clone https://github.com/your-org/pulsedeck.git
cd pulsedeck
docker compose up
```

Then:

1. Open **http://localhost:3000**.
2. Complete the **`/setup`** wizard — create the admin user and your first workspace.
3. Go to **Sources → Add source**, give it a name, and copy the one-time **registration token** (`reg_…`).
4. Run the demo agent and watch the dashboard fill in under two minutes:

```bash
npx pulsedeck-demo --url http://localhost:3000 --token reg_xxxxxxxx
```

The demo agent registers as a real source and pushes a fresh, realistic report every ~30 seconds over the exact same HTTP protocol any agent uses. Once you're convinced, swap it for a real agent.

> `http://localhost:3000` is the web origin; nginx proxies `/api` to the API. You can also point the demo straight at the API on `http://localhost:3001`.

---

## The demo agent

A zero-dependency Node CLI ([`packages/demo`](packages/demo)) that dogfoods the public protocol — it speaks plain HTTP exactly like a third-party agent, with no internal imports.

```bash
pulsedeck-demo --url <BASE_URL> --token <reg_xxx> [--interval <ms>] [--once]
```

| Flag         | Description                                                                      |
| ------------ | -------------------------------------------------------------------------------- |
| `--url`      | Base URL of PulseDeck (e.g. `http://localhost:3000` or `http://localhost:3001`). |
| `--token`    | One-time registration token from **Add source**.                                 |
| `--interval` | Delay between pushes in ms (default `30000`). Ignored with `--once`.             |
| `--once`     | Register and push exactly one report, then exit.                                 |

It cycles through six realistic templates — an **SEO Audit**, a **Deployment Summary**, a **Daily Revenue Snapshot**, an **Infra & Cost** report, an **Incident Post-Mortem**, and a **Market Digest** — collectively exercising all 8 block types with varied severity, tags, recent timestamps, and trending/randomized values so charts and series look alive.

Run it from the repo without publishing to npm:

```bash
pnpm --filter @pulsedeck/demo build
node packages/demo/dist/cli.js --url http://localhost:3001 --token reg_xxx --once
# or, without building:
pnpm --filter @pulsedeck/demo dev -- --url http://localhost:3001 --token reg_xxx --once
```

---

## Agent integration protocol (in brief)

The dashboard's **Add source** screen gives you a copy-paste **setup prompt** with your token and the live schema embedded — hand it to any capable agent and it can integrate itself. The wire contract:

**1. Register (one time):**

```http
POST {BASE_URL}/api/v1/sources/register
X-Registration-Token: reg_xxx
Content-Type: application/json

{ "name": "My Agent", "agent_version": "1.0.0" }
```

→ `{ "source_id": "src_…", "api_key": "pd_…", "schema": { … } }`. The token is single-use; store the `api_key`.

**2. Publish a report:**

```http
POST {BASE_URL}/api/v1/reports
Authorization: Bearer pd_…
Idempotency-Key: <uuid you generate per report>
Content-Type: application/json

{
  "version": "1.0",
  "source":   { "id": "src_…" },
  "category": { "slug": "engineering" },
  "stream":   { "slug": "deployments" },
  "report":   { "title": "Deploy v2.3.1", "occurred_at": "2026-06-20T09:00:00Z", "severity": "info" },
  "blocks":   [ /* metric · markdown · chart · table · timeline · alert · status · artifact */ ]
}
```

Status contract: **201** created · **200** idempotent replay · **422** validation failure (with `issues[]`) · **401** bad key · **403** out of scope · **409** unknown slug (autocreate off) · **429** rate limited. Categories and streams are auto-created by slug when the source permits it (the default).

**3. Discover the schema:** `GET {BASE_URL}/api/v1/schema` → `{ version, schema }`.

The 8 block types and their exact fields are documented in [`BLOCK_SCHEMA.md`](BLOCK_SCHEMA.md) and implemented once in [`packages/schema`](packages/schema).

---

## Realtime

Live updates degrade gracefully — PulseDeck never blocks on infrastructure:

- **SSE (default)** — the dashboard subscribes to `GET /api/v1/workspaces/:id/events` and updates live. Works single-instance with no extra services.
- **Redis fan-out (optional)** — set `REDIS_URL` and enable the `realtime` compose profile to fan SSE across multiple API replicas.
- **Polling (fallback)** — set `SSE_ENABLED=false` (or on disconnect) and clients refetch on an interval.

---

## Self-hosting & configuration

Copy `.env.example` to `.env` and adjust. Key variables:

| Variable                                    | Required | Default   | Description                                                                                      |
| ------------------------------------------- | -------- | --------- | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                              | ✓        | —         | PostgreSQL connection string.                                                                    |
| `AUTH_SECRET`                               | ✓        | —         | Session-signing secret; **≥ 32 chars**, random.                                                  |
| `PORT`                                      | —        | `3001`    | API listen port.                                                                                 |
| `RETENTION_DAYS`                            | —        | `0`       | Purge reports older than N days; `0` keeps forever. Advisory-locked, single-run across replicas. |
| `RETENTION_SWEEP_INTERVAL_MS`               | —        | `3600000` | How often the retention sweep runs.                                                              |
| `REDIS_URL`                                 | —        | —         | Enables cross-replica realtime fan-out. Never required.                                          |
| `SSE_ENABLED`                               | —        | `true`    | Master switch for the realtime SSE endpoint.                                                     |
| `BETTER_AUTH_URL`                           | —        | —         | Public origin for OAuth callbacks / cross-origin clients.                                        |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | —        | —         | Set both to enable GitHub login; leave empty to hide it.                                         |
| `BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD`    | —        | —         | Seed an admin on first boot to skip `/setup` headlessly (idempotent).                            |

Migrations run automatically on API startup. The web container's nginx proxies `/api` to the `api` service, so the SPA, auth, and SSE stream are all same-origin in production.

---

## Tech stack

- **Backend** — Node 22, Fastify 5, Drizzle ORM, PostgreSQL 16, better-auth, Zod.
- **Frontend** — React + Vite + Tailwind, served by nginx in production.
- **Shared** — `@pulsedeck/schema` (the Zod wire contract used by API, web, and the setup prompt).
- **Infra** — Docker Compose; optional Redis for realtime fan-out.

---

## Development

PulseDeck is a pnpm monorepo (Node ≥ 22, pnpm 9).

```bash
pnpm install            # install the workspace

pnpm dev                # run API (3001) + web (3000) together
pnpm build              # build every package/app
pnpm typecheck          # type-check the workspace
pnpm lint               # eslint
pnpm test               # run tests
pnpm format             # prettier --write
```

Workspace layout:

```
apps/
  api/          Fastify ingestion + read API, auth, migrations
  web/          React dashboard (Vite + Tailwind, nginx in prod)
packages/
  schema/       The canonical Zod report/block schema (the wire contract)
  sdk/          Client SDK (stub; ships in v1.1)
  demo/         The pulsedeck-demo agent (this phase)
```

Database migrations (from `apps/api`): `pnpm --filter @pulsedeck/api db:generate` to author and `db:migrate` to apply; they also run automatically on API boot.

---

## License

PulseDeck is licensed under the **GNU Affero General Public License v3.0** ([`LICENSE`](LICENSE)). You can self-host freely; anyone offering PulseDeck as a network service must release their modifications under the same license. Commercial relicensing is available separately. Contributions require signing a CLA — see [`CONTRIBUTING.md`](CONTRIBUTING.md).
