# PulseDeck

**The agent intelligence inbox** — a self-hostable, open-source dashboard where AI agents, automations, and scripts push structured reports that land organized, searchable, and readable for humans.

AI agents generate valuable intelligence, but their outputs are trapped in noisy Slack channels, scattered emails, terminal logs, and markdown dumps. PulseDeck is the destination layer that was missing: instead of flooding your channels with raw output, agents send **schema-validated structured reports** to PulseDeck, where humans consume distilled insights over time.

> The agent does the analysis. PulseDeck displays the curated result — a briefing room, not a raw database.

---

## Features

- **Agent-native ingestion** — a simple, schema-driven HTTP protocol. Any agent that speaks it can publish: register once with an invite token, then `POST` reports. Synchronous validation returns structured `issues[]` so agents can self-correct.
- **8 strict block types** — `metric`, `markdown`, `chart`, `table`, `timeline`, `alert`, `status`, `artifact`. One stable wire contract, predictable rendering, no JSON chaos.
- **Structured report viewer** — flat, sequential rendering of every block: metric cards with trend + sentiment, sanitized markdown (raw HTML disabled), line/bar/area charts, real-type-sortable tables, timelines, alert banners, status grids, and drill-down artifact links.
- **Categories → streams → reports** — navigation tree auto-generated from the data; reports are immutable and append-only.
- **Dashboards** — a 12-column grid builder with 5 widget types (stream feed, metric, chart, report count, alert feed). Multiple dashboards per workspace; one default landing; an auto "Overview" fallback so the page is never blank.
- **Full-text search + filters** — PostgreSQL `tsvector` search over title/summary/tags, plus filters by category, stream, source, severity, tags, and date range. No external search service.
- **Workspaces + RBAC** — multiple workspaces, four roles (Owner / Admin / Editor / Viewer), invite links, first-run setup wizard.
- **Source management** — register agents via one-time invite tokens, rotate/revoke API keys, set write scope, and see connected-agent health (active / stale / never).
- **Realtime (optional, degrades gracefully)** — Server-Sent Events push updates live; falls back to polling with no config. Redis is needed only for multi-replica fan-out.
- **Self-hostable in one command** — `docker compose up`. No required services beyond PostgreSQL.
- **Retention** — optional time-based purge (`RETENTION_DAYS`), single-run across replicas via a Postgres advisory lock.

---

## Tech stack

| Layer          | Choice                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **Backend**    | Node.js (LTS), Fastify, TypeScript                                                                   |
| **Database**   | PostgreSQL 16, Drizzle ORM (with `tsvector` full-text search)                                        |
| **Validation** | Zod — a single shared `packages/schema` is the source of truth (backend validates, frontend renders) |
| **Auth**       | better-auth (email/password + optional GitHub OAuth)                                                 |
| **Realtime**   | Server-Sent Events; Redis pub/sub only for multi-replica fan-out                                     |
| **Frontend**   | Vite, React, TanStack Router + Query, Tailwind + ShadCN, Recharts, react-markdown                    |
| **Infra**      | Docker Compose, pnpm workspaces monorepo                                                             |

```
pulsedeck/
  apps/
    api/        # Fastify backend
    web/        # Vite + React frontend
  packages/
    schema/     # shared Zod schemas + types (single source of truth)
    demo/       # the demo agent (node packages/demo/dist/cli.js)
```

---

## Quick start (Docker — one command)

Requires Docker + Docker Compose.

```bash
git clone <repo-url> pulsedeck && cd pulsedeck
docker compose up
```

Open **http://localhost:3000**, complete the `/setup` wizard (create your admin + workspace), and you're running. Migrations apply automatically on startup.

### See it fill with live data in under 2 minutes

1. In the dashboard, go to **Sources → Add source**, name it, and copy the one-time registration token (`reg_…`).
2. Run the demo agent — it registers and pushes realistic reports (exercising all 8 block types) every 30s:

```bash
# from the repo root (requires Node + pnpm install once)
pnpm --filter @pulsedeck/demo dev --url http://localhost:3000 --token reg_xxxxx
# one-shot instead of a loop:  add --once
pnpm --filter @pulsedeck/demo dev --url http://localhost:3000 --token reg_xxxxx --once
```

Watch the categories, streams, charts, and the realtime feed populate.

### Changing host ports (port already in use)

The containers publish host ports that are **overridable** — handy when a port is already taken (e.g. you already run Postgres on `5432`, which causes
`Bind for 0.0.0.0:5432 failed: port is already allocated`).

Set the port(s) inline:

```bash
POSTGRES_PORT=5544 docker compose up
# multiple:
WEB_PORT=8080 API_PORT=8081 POSTGRES_PORT=5544 docker compose up
```

…or persist them in a root `.env` file (Compose reads it automatically):

```bash
cp .env.example .env      # then edit WEB_PORT / API_PORT / POSTGRES_PORT
docker compose up
```

| Variable        | Default | Container           |
| --------------- | ------- | ------------------- |
| `WEB_PORT`      | `3000`  | web (the dashboard) |
| `API_PORT`      | `3001`  | api                 |
| `POSTGRES_PORT` | `5432`  | postgres            |

These change only the **host** publish ports; the containers always reach each other over the internal network, so changing them never breaks anything. (Postgres is published mainly so you can connect from your host — the app does not depend on it.)

> **Before any real use:** set a strong `AUTH_SECRET` (≥32 chars), e.g. put `AUTH_SECRET=$(openssl rand -base64 48)` in `.env`.

---

## Local development (without Docker)

Requires Node 22 (LTS) + pnpm 9 + a PostgreSQL 16 instance.

```bash
pnpm install

# 1. Point the API at your Postgres and set a secret (>=32 chars):
cp .env.example .env
#    edit DATABASE_URL and AUTH_SECRET in .env

# 2. Apply migrations:
pnpm --filter @pulsedeck/api db:migrate

# 3. Run API (:3001) + web (:3000) together:
pnpm dev
```

The web dev server proxies `/api` → `http://localhost:3001`, so it's same-origin (cookies stay first-party). Open **http://localhost:3000**.

### Useful scripts

```bash
pnpm typecheck                          # all packages
pnpm lint                               # eslint
pnpm build                              # build every package
pnpm --filter @pulsedeck/api test       # API + integration tests (needs DATABASE_URL)
pnpm --filter @pulsedeck/schema test    # schema contract tests

pnpm --filter @pulsedeck/api db:generate   # generate a migration from schema changes
pnpm --filter @pulsedeck/api db:migrate    # apply migrations
pnpm --filter @pulsedeck/api db:studio     # Drizzle Studio
```

---

## Configuration

All config is via environment variables (see [`.env.example`](./.env.example)).

| Variable                                    | Required | Default   | Purpose                                                  |
| ------------------------------------------- | -------- | --------- | -------------------------------------------------------- |
| `DATABASE_URL`                              | ✓        | —         | PostgreSQL connection string                             |
| `AUTH_SECRET`                               | ✓        | —         | Session/token signing secret (**≥32 chars**)             |
| `PORT`                                      | —        | `3001`    | API listen port                                          |
| `RETENTION_DAYS`                            | —        | `0`       | Purge reports older than N days (`0` = keep forever)     |
| `RETENTION_SWEEP_INTERVAL_MS`               | —        | `3600000` | Retention sweep interval (when enabled)                  |
| `REDIS_URL`                                 | —        | —         | Enables multi-replica SSE fan-out (optional)             |
| `BETTER_AUTH_URL`                           | —        | —         | Public origin for OAuth callbacks (set for GitHub login) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | —        | —         | Enable the GitHub login button (both required)           |
| `BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD`    | —        | —         | Headless first-run admin seed (skips `/setup`)           |

### Realtime tiers (auto-detected at boot)

| Tier                    | Config                   | Behavior                                           |
| ----------------------- | ------------------------ | -------------------------------------------------- |
| **Polling**             | `SSE_ENABLED=false`      | Client refetches on interval. Fully functional.    |
| **Single-instance SSE** | default (no `REDIS_URL`) | In-process fan-out to connected clients. No Redis. |
| **Multi-instance SSE**  | `REDIS_URL` set          | Redis pub/sub fans out across replicas.            |

Enable Redis with the compose profile when you need it: `docker compose --profile realtime up`.

---

## Agent integration (in brief)

Agents speak plain HTTP — no SDK required. The dashboard's **Add source** page renders a ready-to-paste setup prompt; the essentials:

```text
# 1. Register (one time) — token from the dashboard, expires in 24h
POST {BASE_URL}/api/v1/sources/register
  Header: X-Registration-Token: reg_xxxxx
  Body:   { "name": "My Agent", "agent_version": "1.0.0" }
  -> { "source_id": "src_...", "api_key": "pd_...", "schema": { ... } }

# 2. Publish a report
POST {BASE_URL}/api/v1/reports
  Header: Authorization: Bearer pd_...
  Header: Idempotency-Key: <uuid>       # reuse on retry to dedupe
  Body:   { "version":"1.0", "source":{"id":"src_..."},
            "category":{"slug":"engineering"}, "stream":{"slug":"deploys"},
            "report":{ "title":"...", "occurred_at":"<ISO 8601>" },
            "blocks":[ ... ] }           # see GET /api/v1/schema
```

Responses follow a strict status-code contract (`201` / `200` dup / `422` validation with `issues[]` / `401` / `403` / `409` / `429`). The [`packages/demo`](./packages/demo) agent is a complete, dependency-free reference implementation.

---

## License

PulseDeck is licensed under the **GNU AGPL v3** — see [`LICENSE`](./LICENSE). Contributions require agreement to the [CLA](./CONTRIBUTING.md). Commercial use as a hosted service requires open-sourcing modifications, or a commercial license.
