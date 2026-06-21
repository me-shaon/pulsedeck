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
