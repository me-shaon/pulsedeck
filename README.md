<div align="center">

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/pulsedeck-logo.svg" />
    <img src="./assets/pulsedeck-logo-light.svg" alt="PulseDeck" width="280" />
  </picture>
</p>

<br />

**A self-hosted dashboard for your AI agents' output.**

Agents, scripts, and automations send their reports to PulseDeck. You get one clean, searchable place to read them — instead of digging through Slack, email, and terminal logs.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-2dd4bf.svg?style=flat-square)](./LICENSE)
![Self-hosted](https://img.shields.io/badge/Self--hosted-one_command-2dd4bf?style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-LTS-339933?style=flat-square&logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169e1?style=flat-square&logo=postgresql&logoColor=white)

[Quick start](#quick-start) · [What you get](#what-you-get) · [Connect an agent](#connect-an-agent) · [Documentation](#documentation)

</div>

---

<p align="center">
  <a href="./assets/dashboard.png" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./assets/dashboard-dark.png" />
      <img src="./assets/dashboard.png" alt="PulseDeck — click to view full size" />
    </picture>
  </a>
</p>

## Quick start

You need [Docker](https://docs.docker.com/get-docker/). That's it.

```bash
git clone <repo-url> pulsedeck && cd pulsedeck
docker compose up
```

Open **http://localhost:3000**, create your account and workspace, and you're running.

### See it with live data

Want to watch it fill up? Run the built-in demo agent — it sends realistic reports every 30 seconds:

1. In the app, go to **Sources → Add source** and copy the registration token (`reg_…`).
2. Run the demo agent:

```bash
pnpm --filter @pulsedeck/demo dev --url http://localhost:3000 --token reg_xxxxx
```

Charts, streams, and the live feed start populating right away.

> **Port already taken?** Override it inline, e.g. `WEB_PORT=8080 docker compose up`.
> Defaults: web `3000`, api `3001`, postgres `5432`.

### Run without Docker

<details>
<summary>Manual setup for local development and production (no Docker required)</summary>

PulseDeck is a standard pnpm monorepo. The only external service it needs is
**PostgreSQL** — Redis is optional (used solely for multi-replica realtime
fan-out). The API applies its database migrations automatically on startup, so
there is no separate migration step.

#### Prerequisites

- **Node.js 22+**
- **pnpm 9.15+** — `corepack enable && corepack prepare pnpm@9.15.0 --activate`
- **PostgreSQL 16+** — running and reachable

#### 1. Install dependencies

```bash
git clone <repo-url> pulsedeck && cd pulsedeck
pnpm install --frozen-lockfile
```

#### 2. Create the database

```bash
psql -U postgres -c "CREATE USER pulsedeck WITH PASSWORD 'pulsedeck';"
psql -U postgres -c "CREATE DATABASE pulsedeck OWNER pulsedeck;"
# Postgres 15+ locks down the public schema — grant it explicitly:
psql -U postgres -d pulsedeck -c "GRANT ALL ON SCHEMA public TO pulsedeck;"
```

#### 3. Configure the API

The API reads its config from `apps/api/.env` (real environment variables always
win). Create it with at least the two required values:

```bash
cat > apps/api/.env <<'EOF'
DATABASE_URL=postgres://pulsedeck:pulsedeck@localhost:5432/pulsedeck
AUTH_SECRET=replace-with-32+-random-chars   # e.g. `openssl rand -base64 48`
EOF
```

All other options (retention, OAuth, signup mode, …) are documented in
[`.env.example`](./.env.example). Note `DATABASE_URL` ships **commented out**
there: the Docker stack builds its own URL (DB host `postgres`) from
`POSTGRES_PASSWORD`, and a `localhost` value in the root `.env` would break it.
For this non-Docker path you set `DATABASE_URL` explicitly (host `localhost`) in
`apps/api/.env`, as above.

#### 4a. Local development (hot reload)

```bash
pnpm dev
```

This starts the API on **:3001** and the web dev server on **:3000** (Vite
proxies `/api` → the API, keeping cookies first-party). Migrations run on API
start. Open **http://localhost:3000**.

The demo agent works the same as above:
`pnpm --filter @pulsedeck/demo dev --url http://localhost:3000 --token reg_xxxxx`.

#### 4b. Production

**Build everything:**

```bash
pnpm build
```

This emits the API bundle to `apps/api/dist` and the static web bundle to
`apps/web/dist`.

**Start the API** (it applies pending migrations, then listens):

```bash
cd apps/api
NODE_ENV=production \
DATABASE_URL=postgres://pulsedeck:pulsedeck@localhost:5432/pulsedeck \
AUTH_SECRET=your-32+-char-secret \
BETTER_AUTH_URL=https://your.domain \
PORT=3001 \
node dist/index.js
```

Keep it alive with a process manager (systemd, pm2, …). `BETTER_AUTH_URL` must be
the **public origin users hit** (the web origin below), not the API port.

**Serve the web bundle.** `apps/web/dist` is static files. The SPA calls `/api`
on its own origin, so put a reverse proxy in front that serves the static files
**and** forwards `/api` to the API. Example nginx (mirrors the bundled
[`apps/web/nginx.conf`](./apps/web/nginx.conf)):

```nginx
server {
  listen 80;
  server_name your.domain;
  root /path/to/pulsedeck/apps/web/dist;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:3001;        # keeps the /api prefix
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Server-Sent Events (live updates): flush immediately, don't time out.
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 1h;
  }

  location / {
    try_files $uri $uri/ /index.html;        # SPA client-side routing
  }
}
```

Caddy alternative (`Caddyfile`):

```caddyfile
your.domain {
  root * /path/to/pulsedeck/apps/web/dist
  handle /api/* {
    reverse_proxy 127.0.0.1:3001
  }
  handle {
    try_files {path} /index.html
    file_server
  }
}
```

Put TLS in front (Caddy does this automatically; for nginx use certbot) and set
`BETTER_AUTH_URL=https://your.domain` to match.

</details>

---

## What you get

- **One inbox for every agent** — reports land organized into categories and streams, newest first.
- **Rich, structured reports** — metrics, charts, tables, timelines, alerts, and status grids, not just walls of text.
- **Search everything** — full-text search and filters by source, severity, tags, and date.
- **Custom dashboards** — drag-and-drop widgets to build the view you want.
- **Teams** — multiple workspaces, roles, and invite links.
- **Live updates** — new reports appear instantly, no refresh needed.
- **Yours to host** — one command, only needs PostgreSQL. No SaaS lock-in.

---

## Connect an agent

Any agent that can make an HTTP request can send reports — no SDK or special library needed. Register once to get an API key, then `POST` your reports.

The **Add source** page in the app gives you a ready-to-paste setup prompt. For the full API, see the [documentation](#documentation).

Want a working example? [`packages/demo`](./packages/demo) is a complete reference agent you can read and copy.

---

## Documentation

Detailed guides — configuration, deployment, the full agent API, and development setup — live on the docs site:

📖 **[PulseDeck Documentation](#)** _(coming soon)_

Quick links for now:

- **Configure** — all options live in [`.env.example`](./.env.example).
- **Develop** — `make dev` runs the whole stack in Docker with hot reload. `make help` lists every command.
- **Contribute** — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## License

PulseDeck is licensed under the **GNU AGPL v3** — see [`LICENSE`](./LICENSE). Contributions require agreement to the [CLA](./CONTRIBUTING.md). Running it as a commercial hosted service requires open-sourcing your changes, or a commercial license.

---

<div align="center">

<img src="./apps/web/public/pulsedeck-mark.svg" alt="PulseDeck" width="40" />

**PulseDeck** — a home for your agents' reports.

<sub>Self-hosted · Open source · AGPL v3</sub>

</div>
