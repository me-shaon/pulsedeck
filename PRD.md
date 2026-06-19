# PulseDeck PRD
## Agent-Native Reporting & Intelligence Platform

---

# Pitch

AI agents, automations, cron jobs, and scripts are rapidly becoming part of modern organizations. But their outputs are still trapped in the wrong interfaces:

- noisy Slack/Mattermost channels
- scattered emails
- terminal logs
- markdown dumps
- disconnected dashboards
- ephemeral notifications

Agents generate valuable intelligence, but there is no standardized way to publish, organize, visualize, and consume that intelligence over time.

## PulseDeck solves this problem.

PulseDeck is a self-hostable, open source platform where AI agents, automations, and external systems push structured reports into a clean, searchable, realtime dashboard.

Instead of flooding communication channels with raw outputs, agents send structured reports to PulseDeck, where humans consume organized insights.

PulseDeck acts as:

- the presentation layer for AI-generated intelligence
- a persistent operational memory system
- a structured reporting protocol for agents
- a realtime dashboard for autonomous systems

The platform is:
- agent-agnostic (any agent that speaks the protocol can push reports)
- API-first
- schema-driven
- human-friendly
- realtime (optional — degrades gracefully)
- self-hostable in one command

---

# The Origin

> *"I got tired of agent reports flooding our channels."*

This product was built from direct experience. Running Hermes agents with Discord/Mattermost/Telegram, setting cron schedules and reporting instructions, watching results get dumped into conversation channels — unorganized, hard to read, impossible to track over time.

The pain is real: spending 40 minutes piecing together what agents did while you were away. Wondering which tasks completed and which stalled. Reading sanitized, optimistic agent summaries with no way to verify the underlying work.

PulseDeck is the destination layer that was missing.

---

# Vision

Create the operational intelligence layer for AI-driven organizations.

A world where:
- agents continuously publish intelligence
- humans consume distilled insights
- organizational knowledge persists historically
- reports become structured, searchable, and visual

---

# Market Validation

## The Pain is Real

Independent research confirms the pain across multiple communities:

> *"I had no idea which agents got done, which ones stalled… I opened my terminal… spent 40 minutes piecing together what my own team had done while I slept."*

> *"The opacity problem… the only visibility you have is what agents choose to report back. Which is often sanitised… and dangerously optimistic."*

> *"This is exactly the kind of problem people underestimate until they're running multiple agents in parallel. The '40 minutes of log archaeology' phase is real."*

> *"I would open a message and typed something like: 'We need a dashboard. I need to be able to open one page and see everything.'"*

The consensus across Hacker News, Reddit, and GitHub: current workflows either dump agent responses to noisy Slack/Discord channels or leave them buried in logs. Users explicitly say they spend too much time hunting for what agents did.

## Competitive Landscape

### Direct Competitors (agent output dashboards)

| Product | What it does | OSS? | Key Gap |
|---|---|---|---|
| OpenClaw Dashboard | Web UI for OpenClaw agents: sessions, cron, system stats | MIT | Framework-specific (OpenClaw only). Dev/infra focus, not business reports. ~670 stars. |
| Canopy | Terminal dashboard showing status of CLI agents | MIT | CLI/TMUX only. No web UI. Developer tool, not for business users. ~17 stars. |

**Verdict: no protocol-agnostic, business-user-friendly, push-based reporting dashboard exists.**

### Adjacent Competitors (agent monitoring — NOT direct)

These tools monitor agents for developers (tokens, traces, latency). They do not provide business-user-friendly structured reporting.

| Product | Focus | Why not a direct threat |
|---|---|---|
| LangSmith | LLM tracing, debugging | Developer metrics, not output dashboards |
| Langfuse | OSS LLM observability | Dev debugging, not business reports |
| Datadog LLM Obs | Infra/cost monitoring | Engineering-DNA, can't pivot to business users |
| Helicone | LLM usage tracking | Prompts/responses for analysis, no human dashboard |
| Arize AI | LLM evaluation/drift | Enterprise ML ops, not agent reports |
| Sentry AI | Error tracking for agents | Errors/exceptions, not structured intelligence |

The key distinction: **monitoring tools are built for engineers debugging systems. PulseDeck is built for humans consuming intelligence.** Different audiences, different interaction models.

## Timing Assessment

- Pain is felt today by early adopters running multi-agent workflows
- No dominant solution occupies this space
- Major observability platforms are adding AI monitoring features but not pivoting to business-user report consumption — their DNA prevents it
- **Window estimate: 12-18 months before better-funded players could occupy this space**

**Verdict: build it now. The gap is open. The pain is validated. The timing is right.**

---

# Product Positioning

## PulseDeck is NOT:
- a BI tool — users cannot run SQL queries or drill into raw data
- an observability platform — not for tokens, traces, latency, or errors
- an agent monitoring tool — not for agent health metrics
- a data explorer — no paginated resource lists, no ad-hoc filtering of underlying data
- an admin panel — no CRUD for business resources
- another Grafana — not for infrastructure metrics
- another Slack — not a communication channel

## PulseDeck IS:
> **"The agent intelligence inbox — where structured reports from AI agents land, organized and readable for humans."**

**The intelligence model:** the agent does the analysis. PulseDeck displays the curated result. Like a McKinsey briefing vs. a raw database — business stakeholders want the briefing, not the database. Agents are the analysts. PulseDeck is the briefing room.

This means: if you need to see a paginated list of all 1,000 CRM records, use your CRM. If you need the agent's weekly sales intelligence briefing, read PulseDeck.

## Who Uses PulseDeck

**Developers build it.** They configure agents to push reports, set up categories and streams, manage sources.

**Business stakeholders read it.** They consume summarized insights — revenue snapshots, SEO audits, incident summaries, campaign performance — without needing to touch the underlying data or understand how the agent works.

---

# Competitive Moat

## Primary Moat: OSS Community (The Grafana Model)

Grafana didn't win because it was OSS. It won because it was OSS and shipped early enough to become the default. No one considered replacing it once every ops team knew it.

PulseDeck's strategy: ship before anyone occupies this space, publish the protocol openly, accumulate GitHub stars and community integrations until the ecosystem itself becomes the moat.

The window is open. The beachhead is the Hermes/OpenClaw community — developers already running agents who feel exactly this pain.

## Supporting Moats

**Organizational moat vs. monitoring giants:** Datadog, Sentry, LangSmith are engineering-DNA companies. They will always optimize for developers first. Their PMs will never fully commit to business-user report consumption — it conflicts with their core customer and culture. They can add a "structured reporting" tab but they can't change their DNA.

**Self-host for privacy:** Teams with compliance requirements, sensitive business data, or on-prem agent deployments cannot send reports to a SaaS monitoring platform. PulseDeck self-hosts completely.

**Protocol ownership (long-term):** If PulseDeck's schema becomes the standard that agent frameworks natively implement, every user of those frameworks becomes a potential user. This is the 3-year play — start by publishing the schema as an open standard.

---

# Core Product Principles

## 1. Agent-First
Everything optimized for API ingestion, push-based publishing, structured schema-validated reports, and machine-generated outputs.

## 2. Protocol-Owned
PulseDeck defines the ingestion schema. Agents conform to it. Benefits: validation is crisp and deterministic, rendering is predictable, agents get structured correction feedback when they send invalid data, and any agent can integrate without coupling to a specific framework.

## 3. Human-Friendly
Non-technical business stakeholders can read dashboards and reports without engineering knowledge.

## 4. Schema-Driven
No arbitrary JSON chaos. All reports follow stable, strictly typed block primitives.

## 5. Self-Hostable by Default
One `docker compose up`. No required external services beyond PostgreSQL. Realtime (Redis/SSE) is optional and degrades gracefully.

---

# Business Model

## License: AGPL v3

Open source core licensed under AGPL v3:
- anyone can self-host freely
- anyone who hosts PulseDeck as a service must open-source their modifications
- commercial use by third parties requires a commercial license

## Strategy: Open Core

| Layer | OSS | Paid SaaS (future) |
|---|---|---|
| Ingestion API | ✓ | ✓ |
| Dashboard + report viewer | ✓ | ✓ |
| Report schema + block types | ✓ | ✓ |
| Self-hosting | ✓ | — |
| AI summaries + digests | — | ✓ |
| Managed cloud hosting | — | ✓ |
| SSO / SAML | — | ✓ |
| Advanced audit logs | — | ✓ |
| Per-workspace retention controls | — | ✓ |

AI summaries are the SaaS moat. They never ship in OSS.

## Contributor License Agreement (CLA)
All contributors sign a CLA to preserve the ability to re-license or offer dual licensing in future.

---

# Target Audience

## Primary (v1)
Developers and agent-operators who:
- run AI agents, automations, or scheduled workflows
- want a structured place for agent outputs to land
- are comfortable self-hosting a Docker Compose stack

Beachhead: developers using Hermes, OpenClaw, n8n, and similar agent frameworks who are currently dumping outputs into Slack/Discord/Mattermost channels.

## Secondary (post-launch)
- agencies running client reporting automations
- growth and operations teams consuming agent-generated insights
- startups with internal AI tooling
- non-technical business stakeholders reading reports built by their engineering team

---

# Go-To-Market

## Authentic Launch Story

> *"I got tired of Hermes reports flooding our Mattermost channels. I built PulseDeck so agent outputs have a proper home."*

This is the launch post. Authentic, specific, and speaks directly to developers who feel the exact same pain.

## Launch Sequence

```
1. Hermes/OpenClaw community (Discord/Mattermost) — day one
   Authentic post from a community member who felt the pain

2. GitHub — same day
   Public repo, strong README, demo GIF, one-command Docker setup

3. Hacker News "Show HN" — week one
   "Show HN: PulseDeck – open source dashboard for AI agent reports"

4. Product Hunt — week two
   Polished launch with demo video
```

## First-User Experience

New users see an empty dashboard. Empty dashboards kill products.

**Solution: one-command demo agent ships with v1.**

A script generates realistic fake reports every 30 seconds — SEO audits, deployment summaries, metric reports. The user runs it locally and sees PulseDeck fill with live data in under 2 minutes — feeling the product work before configuring a single real agent.

```bash
# From the repo
npx pulsedeck-demo --url http://localhost:3000 --token <invite-token>
```

The demo agent is replaced with a real one once the user is convinced.

---

# Core Use Cases

Each use case follows the same model: an agent runs on a schedule or trigger, does the work, and pushes a structured report to PulseDeck. Humans consume the result. PulseDeck is not the data source — it's the destination for the agent's intelligence.

## Sales & Revenue Intelligence

**Daily Sales Report** — Agent pulls CRM data (Salesforce, HubSpot, Pipedrive), generates a structured daily digest: new deals, closed revenue, pipeline changes, rep performance. Sales managers open PulseDeck each morning instead of building manual reports.

**Revenue Snapshot** — Agent fetches billing/Stripe data, pushes daily revenue metrics (MRR, new subscriptions, churn, refunds) as metric + chart blocks. Finance and founders get a clean daily briefing.

## Engineering & DevOps

**Deployment Summary** — Agent hooks into CI/CD (GitHub Actions, CircleCI), generates a post-deployment report: what changed, which tests ran, pass/fail rate, performance delta vs previous deploy.

**Daily Commit Digest** — Agent reads git log, formats a daily summary of commits merged (author, description, files touched) as a timeline + markdown report.

**CI/CD Health Report** — Agent tracks build success rates, test flakiness, average build time over time. Pushes weekly trend reports with charts.

**Infrastructure Cost Report** — Agent pulls AWS/GCP/Azure billing APIs, generates a daily cost report with metric blocks per service and anomaly alerts when spend spikes.

**Database Health Digest** — Agent queries `pg_stat_activity`, slow query logs, table sizes — pushes a daily health summary.

## Uptime & Incident Intelligence

**Daily Uptime Digest** — An existing monitoring agent (UptimeRobot, Pingdom, custom) pushes a daily summary: uptime percentage, incident count, MTTR, affected services. PulseDeck is NOT an uptime monitor — it receives the digest from one.

**Incident Summary Report** — When an incident resolves, the agent pushes a structured post-mortem: timeline, affected services, root cause, resolution steps. Incidents accumulate in a stream, searchable over time.

## SEO & Content Marketing

**SEO Audit Report** — Agent runs a full SEO audit (keyword rankings, page performance, Core Web Vitals, backlinks) and pushes a structured report with metric and table blocks.

**ASO Report** — Agent monitors App Store keyword rankings, download estimates, review sentiment — pushes a weekly ASO intelligence digest.

**Content Performance Report** — Agent pulls blog/YouTube/newsletter analytics, generates a weekly content performance summary.

**Competitor Monitoring Report** — Agent monitors competitor websites, pricing, job postings, social activity — generates a weekly competitive briefing.

## Community & Market Research

**Reddit Market Research Digest** — Agent monitors targeted subreddits, extracts top posts, trending topics, sentiment shifts — pushes a weekly market intelligence report.

**Top News Summary** — Agent fetches news from RSS/APIs, filters by topic, AI-summarizes key stories — pushes a daily digest with markdown summaries and links.

**Social Listening Report** — Agent monitors Twitter/X, LinkedIn, Reddit mentions of a brand — generates a weekly sentiment and volume report.

## Customer & Support Intelligence

**Support Ticket Digest** — Agent pulls from Zendesk/Intercom/Freshdesk, generates a daily digest: ticket volume, category breakdown, CSAT, top recurring issues.

**App Store Reviews Digest** — Agent fetches new App Store and Google Play reviews, generates a daily sentiment summary with notable highlights.

## Finance & Operations

**Market Research Report** — Agent fetches financial data (stocks, crypto, commodities), generates a daily portfolio or market summary with metric blocks and trend charts.

**Inventory & Supply Chain Alert** — Agent monitors inventory levels, supplier lead times, stock-outs — pushes a daily operational summary with alert blocks for critical thresholds.

## Personal & Solo Use

**Personal Productivity Digest** — Agent tracks task completion (Todoist, Linear, Notion), time spent, habits — pushes a weekly personal performance report.

**AI Research Dashboard** — Researcher runs multiple AI agents gathering literature, summarizing papers, tracking a topic — pushes structured summaries as they complete.

**Habit & Health Monitoring Report** — Agent pulls from health APIs or manual logs, generates a weekly habit tracking summary.

---

# Core Domain Model

## Workspace
A single product or project being monitored (e.g. E-commerce App, Internal Marketing Bot, Personal AI Workflows). One PulseDeck deployment can have multiple workspaces. Users belong to workspaces with roles.

## Members
Users inside a workspace. Workspace-level roles:
- **Owner** — full control, can delete workspace
- **Admin** — manage users, sources, all content
- **Editor** — create/manage categories and streams, build dashboards, view all reports
- **Viewer** — read-only access to all reports

## Sources
External agents or systems that push reports into a workspace (e.g. Hermes Production Agent, OpenClaw SEO Bot, n8n Workflow, Custom Python Script). Registered via an invite-token handshake (see Agent Integration Protocol).

## Categories
Top-level logical grouping within a workspace (e.g. Engineering, Marketing, SEO, Sales, Operations).

## Streams
Continuous report feeds inside a category (e.g. Daily SEO Reports, Deployment Reports, Infrastructure Summaries).

## Reports
Single report instances published by a source (e.g. Daily SEO Report — May 22). Reports are immutable and append-only.

## Blocks
Strictly typed UI primitives rendered inside reports.

## Dashboards
User-curated pages of widgets within a workspace. A workspace can have many dashboards; one is the default landing view.

---

# Block Primitives

Eight supported block types. Strict schema — no custom types in v1.

The authoritative wire contract lives in [`BLOCK_SCHEMA.md`](./BLOCK_SCHEMA.md) and is implemented once in `packages/schema` (Zod). Backend validates with it; frontend renders with it. The snippets below illustrate the shape; `BLOCK_SCHEMA.md` is the source of truth.

**Every block carries a common envelope:** a unique `id`, the `type`, and optional `title`/`caption`. Rendering is flat and sequential — blocks display in the order the agent sent them.

**Canonical enums (defined once, shared everywhere):**
- `severity`: `info` | `warning` | `critical`
- `status`: `healthy` | `degraded` | `down` | `unknown`
- `trend`: `up` | `down` | `flat` (direction/geometry)
- `sentiment`: `positive` | `negative` | `neutral` (color meaning — e.g. latency up = negative)

### metric
```json
{
  "id": "blk_lat",
  "type": "metric",
  "key": "api_latency_p95",
  "label": "Avg API Latency",
  "value": 421,
  "unit": "ms",
  "format": "duration",
  "trend": "up",
  "sentiment": "negative",
  "delta": 14,
  "comparison_label": "vs yesterday"
}
```
`key` is a stable machine identifier (distinct from the human `label`). Dashboard widgets select a series by `key`, never by display label.

### markdown
```json
{
  "id": "blk_sum",
  "type": "markdown",
  "content": "# Summary\nLatency increased **14%** compared to yesterday."
}
```
Rendered with raw HTML disabled (XSS guard).

### chart
```json
{
  "id": "blk_vol",
  "type": "chart",
  "variant": "line",
  "title": "Request Volume",
  "labels": ["Mon", "Tue", "Wed"],
  "x_axis": "Day",
  "y_axis": "Requests",
  "series": [{ "name": "Requests", "data": [120, 145, 98] }]
}
```
`variant`: `line` | `bar` | `area`. Labels may be ISO timestamps for time-series.

### table
```json
{
  "id": "blk_svc",
  "type": "table",
  "columns": [
    { "key": "service", "label": "Service", "type": "string" },
    { "key": "latency", "label": "Latency", "type": "number", "unit": "ms" }
  ],
  "rows": [
    { "service": "API", "latency": 42 },
    { "service": "Worker", "latency": 890 }
  ]
}
```
Typed columns + keyed rows so sorting works on real types and column reorder is safe.

### timeline
```json
{
  "id": "blk_dep",
  "type": "timeline",
  "events": [
    { "time": "2026-05-22T09:00:00Z", "label": "Deploy started", "status": "healthy" },
    { "time": "2026-05-22T09:04:00Z", "label": "Deploy complete", "status": "healthy" }
  ]
}
```

### alert
```json
{
  "id": "blk_alrt",
  "type": "alert",
  "severity": "warning",
  "title": "High latency detected",
  "message": "P95 latency exceeded 500ms threshold."
}
```

### status
```json
{
  "id": "blk_stat",
  "type": "status",
  "items": [
    { "key": "api", "label": "API", "status": "healthy" },
    { "key": "worker", "label": "Worker", "status": "degraded" }
  ]
}
```

### artifact
```json
{
  "id": "blk_pdf",
  "type": "artifact",
  "label": "Full Audit Report",
  "url": "https://storage.example.com/audit.pdf",
  "mime_type": "application/pdf"
}
```
The `artifact` block handles drill-down: when a stakeholder wants more detail than the report surface shows, the agent links to the full underlying data (CSV, PDF, external URL). PulseDeck surfaces the intelligence; the source system holds the raw data. Links render with `rel="noopener"` and are never fetched server-side.

**Ingestion limits** (enforced, return `422`): ≤50 blocks/report, ≤1000 table rows, ≤20 columns, ≤10 chart series, ≤500 points/series, ≤50,000 markdown chars, ≤1 MB payload.

---

# Canonical Report Schema

```json
{
  "version": "1.0",
  "workspace": "my-ecommerce-app",
  "source": { "id": "src_hermes_prod" },
  "category": { "slug": "engineering" },
  "stream": { "slug": "daily-infra-reports" },
  "report": {
    "title": "Daily Infrastructure Summary",
    "summary": "2 incidents detected, avg latency up 14%.",
    "severity": "warning",
    "occurred_at": "2026-05-22T10:00:00Z",
    "tags": ["production", "infra"]
  },
  "blocks": [
    { "id": "blk_1", "type": "metric", "key": "api_latency", "label": "Avg API Latency", "value": 421, "unit": "ms" },
    { "id": "blk_2", "type": "markdown", "content": "Latency increased 14% compared to yesterday." },
    {
      "id": "blk_3",
      "type": "table",
      "columns": [
        { "key": "service", "label": "Service", "type": "string" },
        { "key": "status", "label": "Status", "type": "string" }
      ],
      "rows": [
        { "service": "API", "status": "Healthy" },
        { "service": "Worker", "status": "Warning" }
      ]
    }
  ]
}
```

---

# Agent Integration Protocol

## Registration Handshake

Agents do not use raw API keys. They register via a one-time invite token issued by a workspace admin.

```
1. Admin creates a Source in the dashboard
   → gets a one-time invite token: reg_xxxxx (expires 24h)
   → dashboard shows a copyable agent setup prompt (below)

2. Agent calls:
   POST /api/v1/sources/register
   X-Registration-Token: reg_xxxxx
   { "name": "Hermes Prod", "agent_version": "2.1.0" }

3. Server responds:
   {
     "source_id": "src_xxx",
     "api_key": "pd_xxx",
     "schema": { ... current schema ... }
   }
   The registration token is invalidated immediately.

4. Agent stores api_key and schema. All future pushes use:
   Authorization: Bearer pd_xxx
```

## Validation Feedback

Ingestion is synchronous. Invalid data returns a structured correction the agent can act on:

```
POST /api/v1/reports
→ 422 Unprocessable Entity
{
  "error": "validation_failed",
  "issues": [
    { "path": "blocks[0].value", "message": "Expected number, received string" }
  ],
  "schema_version": "1.0"
}
```

## Idempotency & Retry Semantics

Retries must not create duplicate reports. Every push carries a client-generated key:

```
POST /api/v1/reports
Authorization: Bearer pd_xxx
Idempotency-Key: <uuid>
```

The server dedups on `(source_id, idempotency_key)`. A repeated key returns the original result instead of inserting again.

Status-code contract:
- `422` validation failed → parse `issues[]`, fix payload, retry once
- `401` invalid/revoked key → stop, re-register via handshake
- `403` push outside the source's allowed scope → stop, surface to operator
- `409` unknown category/stream slug (when auto-create is off) → stop, surface to operator
- `429` rate limited → exponential backoff
- `5xx` server error → exponential backoff (safe; idempotency key prevents dupes)

Per-source rate limits and the 1 MB payload cap apply.

## Schema Discovery

`GET /api/v1/schema` returns the current schema and version so agents can self-update. All schema changes within 1.x are additive (new optional fields, new block types).

## Copyable Agent Setup Prompt

The source setup page renders a ready-to-paste instruction block the operator hands to any agent. It is self-contained, so the agent can integrate with zero external docs. This is the primary agent-adoption lever — copy, paste into the agent's system prompt, done.

```text
You are integrated with PulseDeck, a reporting platform. Publish your structured
results to it by following this protocol exactly.

BASE URL: {{BASE_URL}}            # e.g. https://pulsedeck.mycompany.com

────────────────────────────────────────────────────────
STEP 1 — REGISTER (one time only)
────────────────────────────────────────────────────────
You have a one-time registration token (expires in 24h):
  REGISTRATION_TOKEN: {{reg_xxxxx}}

Call:
  POST {{BASE_URL}}/api/v1/sources/register
  Header: X-Registration-Token: {{reg_xxxxx}}
  Body:   { "name": "<your agent name>", "agent_version": "<your version>" }

Response:
  { "source_id": "src_...", "api_key": "pd_...", "schema": { ... } }

Store api_key and schema securely. The registration token is now dead — never
reuse it. If you already registered, skip to STEP 2.

────────────────────────────────────────────────────────
STEP 2 — PUBLISH A REPORT
────────────────────────────────────────────────────────
  POST {{BASE_URL}}/api/v1/reports
  Header: Authorization: Bearer <api_key>
  Header: Idempotency-Key: <unique id you generate per report>
  Body (must match the schema you received):

  {
    "version": "1.0",
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
    GET {{BASE_URL}}/api/v1/schema
```

## Dashboard: Connected Agents

The dashboard shows all registered sources with last-seen timestamp, schema version in use, report count, and health status (active / stale / never connected).

---

# Core Product Features

## 1. Structured Report Viewer
Renders all 8 block types consistently with flat sequential rendering — markdown, metric cards, sortable typed tables, line/bar/area charts, timelines, alert banners, status grids, artifact download links.

## 2. Report List & Detail
- **List** (stream view): chronological, filtered, paginated/infinite-scroll list of reports for a stream. A workspace-wide "All Reports" list uses the same component.
- **Detail**: permalink route `/w/:ws/r/:reportId` rendering all blocks plus metadata (source, severity, tags, `occurred_at`, `received_at`), artifact links, and prev/next within the stream. Permalinks enable internal deep-linking; public sharing is a future feature. Reports are immutable; deletion only via retention.

## 3. Categories & Streams
Reports are organized into categories → streams → individual reports. The category/stream tree is the primary report navigation and is auto-generated from the data.

## 4. Dashboards & Navigation

**Structured grid dashboard builder.** Users build dashboards by adding widgets to a 12-column responsive grid. Widget types:
- Stream Feed (latest N reports from a stream)
- Metric Widget (latest metric value from a stream, selected by metric `key`)
- Chart Widget (time-series of a metric across reports)
- Report Count (report volume over time)
- Alert Feed (recent alerts from a category)

Each widget configures its source stream/category, display options, and column span (full / half / third). Rows can be reordered.

**Dashboards as pages.** A workspace can have many dashboards, each a page in the sidebar. One is marked default and is the landing view. On a fresh workspace with no custom dashboards, a system "Overview" (recent reports + connected agents) is shown so the landing page is never blank.

**Sidebar.** Part-fixed, part-generated — users do not hand-build the whole menu:
- **Fixed system items**: Overview/Activity, Search, Sources, Settings.
- **Dashboards**: user-created pages, ordered and pinnable.
- **Categories → Streams**: auto-generated from the data.

RBAC gates who builds dashboards and who creates categories/streams.

## 5. Search
- Filter by: workspace, category, stream, source, severity, tags, date range.
- Full-text search: PostgreSQL `tsvector` GIN index over report title, summary, and tags. No external search service required.

## 6. Source Management
Workspace admins can create sources (generate invite tokens), set a source's write scope, revoke and rotate API keys, and view connected agent status and schema version.

## 7. Realtime Updates (optional, never a blocker)
Realtime is an enhancement. The app boots and is fully usable with no Redis and no SSE — users still see fresh data on refresh. Three tiers, auto-detected at boot:

| Tier | Config | Behavior |
|---|---|---|
| Polling | no `REDIS_URL`, SSE off | Client refetches on interval / manual refresh. Fully functional. |
| Single-instance SSE | no `REDIS_URL`, SSE on | In-process event emitter fans out to SSE clients. No Redis needed. |
| Multi-instance SSE | `REDIS_URL` set | Redis pub/sub fans out across replicas. |

On every push the report is saved to PostgreSQL; if SSE is enabled an event is emitted (in-process, or via Redis when multi-instance) and connected clients update without a page refresh. Redis is required only for multi-replica fan-out, not for realtime itself.

## 8. Notifications — Webhook (v1.1)
A report inbox that can't poke you when something is on fire is a passive archive. The uptime/incident/cost-spike use cases need an escape hatch for the urgent few. Scope is deliberately minimal — a **router, not an alerting platform** (no on-call schedules, escalation chains, or silencing UIs).

**Design intent — don't rebuild the noise PulseDeck kills.** The briefing stays inside PulseDeck; only the urgent minority escapes as a ping. Notifications are selective (severity filter + throttle), never a re-broadcast of every report.

**v1.1 scope: outbound webhook on rule match.**
- Workspace-level rules: `when report.severity matches [filter] in [category/stream] → POST to [webhook URL]`.
- One outbound POST unlocks Slack, Discord, Mattermost, Teams, and PagerDuty — all accept incoming webhooks. No per-provider integrations to build.
- Throttle/dedup so a flapping source can't spam the channel.

The v1 ingestion event stream (the same one that powers SSE) is the seam a notification consumer attaches to later — no new plumbing required. Native email (SMTP) and per-user subscription preferences come after webhook proves the routing model.

---

# Authentication & Authorization

## Dashboard Auth
- Email/password + sessions via **better-auth** (maintained, TypeScript-native, supports email/password and OAuth out of the box).
- GitHub OAuth: opt-in via `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`. If unset, the GitHub login button does not appear.

## First-Run Onboarding
On a fresh install with zero users:
1. All routes redirect to `/setup`.
2. Admin fills in name, email, password.
3. Admin account is created and `/setup` is permanently disabled.
4. Admin invites teammates via workspace settings (invite link per role).

Headless/automated installs: set `BOOTSTRAP_EMAIL` + `BOOTSTRAP_PASSWORD` to seed the admin on startup and skip `/setup`.

## Authorization (RBAC, workspace-level)

| Action | Owner | Admin | Editor | Viewer |
|---|---|---|---|---|
| Delete workspace | ✓ | — | — | — |
| Manage users | ✓ | ✓ | — | — |
| Manage sources | ✓ | ✓ | — | — |
| Create categories/streams | ✓ | ✓ | ✓ | — |
| Build dashboards | ✓ | ✓ | ✓ | — |
| View reports | ✓ | ✓ | ✓ | ✓ |

---

# Tech Stack

## Backend
- **Runtime:** Node.js (LTS)
- **Framework:** Fastify + TypeScript
- **Database:** PostgreSQL 16
- **ORM:** Drizzle (SQL-like TypeScript, native JSONB support)
- **Validation:** Zod (shared `packages/schema`)
- **Auth:** better-auth (email/password + GitHub OAuth)
- **Rate limiting:** `@fastify/rate-limit` (per-source ingestion limits)
- **Realtime (optional):** Server-Sent Events; Redis pub/sub only for multi-replica fan-out
- **Scheduling:** in-process job runner (retention purge) guarded by a Postgres advisory lock

## Frontend
- **Bundler:** Vite
- **Framework:** React + TypeScript
- **Router:** TanStack Router (type-safe)
- **Data fetching:** TanStack Query (cache + polling fallback when realtime is off)
- **UI:** ShadCN (composable, not black-box)
- **Charts:** Recharts
- **Markdown:** react-markdown (raw HTML disabled)

## Infrastructure
- **Self-hosting:** Docker Compose (single command)
- **Repo:** Monorepo (pnpm workspaces)
- **Ops:** `/healthz` endpoint, migrations run on startup, UTC storage with per-user timezone display

## Monorepo Structure
```
pulsedeck/
  apps/
    api/          # Fastify backend
    web/          # Vite + React frontend
  packages/
    schema/       # shared Zod schemas, block types, API types — single source of truth
    sdk/          # agent SDK (v1.1)
```

`packages/schema` is the single source of truth for block types and API contracts. The backend validates with it; the frontend renders with it.

---

# Data Model

## Core Tables

```
workspaces         (id, name, slug, default_dashboard_id, created_at)
workspace_members  (workspace_id, user_id, role)
users              (id, email, password_hash, name, created_at)
sources            (id, workspace_id, name, api_key_hash, agent_version,
                    scope, allow_stream_autocreate, last_seen_at)
                    -- scope: 'workspace' (default) | 'category' | 'stream'
source_categories  (source_id, category_id)  -- consulted only when scope = 'category'
source_streams     (source_id, stream_id)    -- consulted only when scope = 'stream'
categories         (id, workspace_id, name, slug, position)
streams            (id, category_id, name, slug, position)
reports            (id, stream_id, source_id, idempotency_key, title, summary, severity,
                    occurred_at, received_at, created_at, tags[],
                    search_vector tsvector, blocks JSONB)
report_metrics     (report_id, stream_id, key, value, occurred_at)  -- extracted on ingest
dashboards         (id, workspace_id, name, slug, icon, position, is_default, layout JSONB)
```

**Notes:**
- `blocks` is stored as JSONB. `search_vector` is a generated `tsvector` with a GIN index over title + summary + tags.
- `idempotency_key` is unique per `(source_id, idempotency_key)` → dedup on retry.
- `received_at` / `created_at` are server timestamps; `occurred_at` is agent-supplied. Ordering and retention use server time.
- `report_metrics` is denormalized from `metric` blocks at ingest so dashboard metric/chart widgets query a flat indexed table instead of scanning JSONB across thousands of reports.
- `position` / `is_default` drive sidebar ordering and the default landing dashboard.

## Source Write Scope

Most agents report to a whole workspace, so the default avoids redundant configuration:
- `scope = 'workspace'` (default) — the source may write to any category/stream in **its own workspace** (never cross-workspace).
- `scope = 'category'` — restricted to categories listed in `source_categories`.
- `scope = 'stream'` — restricted to streams listed in `source_streams`.

A push outside the allowed scope returns `403`. Sources are always workspace-bound; keys are revocable, rotatable, and rate-limited — so even the default has a bounded blast radius. `allow_stream_autocreate` (default true) lets a source create streams on push; when false, a push to an unknown stream slug returns `409`.

---

# Self-Hosting

## Docker Compose

```yaml
# docker-compose.yml
services:
  api:
    image: pulsedeck/api:latest
    environment:
      DATABASE_URL: postgres://...
      AUTH_SECRET: changeme
      RETENTION_DAYS: 0
      # Optional — realtime degrades gracefully without these:
      # REDIS_URL: redis://redis:6379   # only needed for multi-replica SSE fan-out
      # GITHUB_CLIENT_ID: ...
      # GITHUB_CLIENT_SECRET: ...
      # BOOTSTRAP_EMAIL: admin@company.com
      # BOOTSTRAP_PASSWORD: changeme123
    depends_on: [postgres]   # redis intentionally not required to boot

  web:
    image: pulsedeck/web:latest
    ports: ["3000:80"]

  postgres:
    image: postgres:16
    volumes: [postgres_data:/var/lib/postgresql/data]

  # Optional: enable only for multi-replica realtime fan-out.
  redis:
    image: redis:7-alpine
    profiles: ["realtime"]

volumes:
  postgres_data:
```

`docker compose up` → visit `localhost:3000` → `/setup` wizard → running. Migrations run automatically on startup.

---

# Report Retention

Controlled by a single env var:

```env
RETENTION_DAYS=0   # 0 = keep forever (default)
RETENTION_DAYS=90  # delete reports older than 90 days
```

An app-side scheduled job purges reports beyond the retention window (not `pg_cron`, which is absent from the stock `postgres:16` image and would break one-command self-hosting). The job ships in the image, is observable (last-run status surfaced in UI/logs), and is testable. Purge is keyed on server `created_at`, never the agent-supplied `occurred_at`. When running multiple `api` replicas, the job takes a Postgres advisory lock so it runs exactly once. The default of `0` (keep forever) prevents surprise data loss on fresh installs.

---

# MVP Scope (v1)

## In
- Agent registration (invite token → handshake → API key + schema)
- Report ingestion API with synchronous schema validation + correction feedback
- Idempotent ingestion (dedup on retry), per-source rate limits, payload caps
- Source write scope (workspace default; category/stream narrowing)
- Report list + report detail permalink pages (immutable, append-only)
- Workspace management + RBAC (4 roles, workspace-level)
- Categories + Streams
- Report viewer (8 strict block types, flat rendering)
- Structured grid dashboard builder (multi-dashboard pages, one default, auto Overview fallback)
- Sidebar navigation (fixed items + dashboards + auto category/stream tree)
- Filtering + PostgreSQL full-text search
- Source management (connected agents, API key rotation)
- Realtime SSE activity feed (optional; app fully usable via refresh without Redis/SSE)
- First-run `/setup` wizard + invite links
- Email/password auth + optional GitHub OAuth (better-auth)
- Global report retention config
- Docker Compose self-hosting (`/healthz`, migrations on startup)
- Demo agent (one-command script that pushes realistic fake reports for instant aha moment)

## Out (later)
- Outbound webhook notifications on severity rule match (v1.1 — routes to Slack/Discord/Mattermost/PagerDuty)
- Agent SDK for JS, Python, PHP (v1.1)
- Email + per-user notification preferences + digest batching (post-v1.1)
- AI summaries and digest reports (SaaS paid feature — never in OSS)
- Shareable public report links
- Exports (PDF, CSV, Markdown)
- Semantic / vector search (pgvector)
- Logging and monitoring ingestion endpoints
- Code/diff block type
- Per-workspace retention controls (SaaS tier)
- SSO / SAML
- Per-category/stream RBAC

---

# Biggest Risks

## Risk 1: Timing Window Closes
The gap is open for 12-18 months. **Solution:** solo full-time build, ~3-4 months to a demo-able v1. Ship, launch, plant the flag. Don't over-engineer before launch — the grid dashboard builder is the heaviest item and can ship behind the auto Overview if the schedule tightens.

## Risk 2: Becoming Generic Dashboard Software
**Solution:** stay laser-focused on agent-generated structured intelligence. Reject feature requests that turn this into a BI tool, data explorer, or generic dashboard builder.

## Risk 3: Schema Complexity
**Solution:** keep block primitives minimal and stable for v1. Resist custom block types until real usage demands them. Extensible registry later.

## Risk 4: Self-Hosting Friction
**Solution:** Docker Compose is a first-class citizen. One command, migrations on startup, setup wizard on first boot, zero manual steps, no required services beyond PostgreSQL.

## Risk 5: Empty Dashboard on First Use
**Solution:** the demo agent ships with v1. New users see a live, filling dashboard within 2 minutes — before configuring a single real agent.

## Risk 6: Agent Adoption
**Solution:** the protocol is simple HTTP + JSON with a copyable setup prompt in the dashboard. The demo agent proves the concept immediately. SDKs follow in v1.1.

---

# Product Differentiation

| Traditional BI | Agent Monitoring | PulseDeck |
|---|---|---|
| Human-built dashboards | Agent health/traces | Agent-generated reports |
| SQL analytics | Infrastructure metrics | Structured operational intelligence |
| Users query raw data | Devs debug systems | Humans consume intelligence briefings |
| Static reports | Real-time system state | Real-time intelligence stream |
| Manual workflows | Observability tooling | Autonomous publishing protocol |
| Data-focused | Developer-focused | Insight-focused |

---

# Long-Term Vision

PulseDeck becomes the operational intelligence standard for AI-driven organizations — a platform where agents continuously publish structured intelligence, organizations retain operational memory, humans consume summarized insights, and the PulseDeck protocol becomes the lingua franca any agent framework implements natively.

The ecosystem currently lacks a strong structured intelligence layer for agents. PulseDeck aims to become that layer — open, extensible, and owned by the community.
