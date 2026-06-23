# Webhook Alert Reporting — Design

> Outbound webhooks: deliver matching reports to external endpoints (generic
> JSON, Slack, Discord, Mattermost) with HMAC signing, retries, and a durable
> delivery log. Designed to run unchanged in OSS self-host and multi-tenant
> cloud (multi-account, multi-replica).

## Goal

Workspace owners/admins register outbound webhooks. Each newly ingested report
that matches a webhook's filter is delivered to the target URL, formatted for
the chosen target, signed (generic), retried with backoff on failure, and
recorded in a per-webhook delivery log.

## Decisions (locked)

- **Trigger:** configurable per-webhook **severity set** AND **category set**.
- **Payload:** versioned generic JSON envelope, plus vendor formatters
  (Slack / Discord / Mattermost).
- **Delivery:** HMAC-signed (generic), retries with backoff, durable delivery log.
- **Management:** REST API + web UI (workspace settings).

## Matching rule

A report fires a webhook when:

```
(webhook.severities is empty OR report.severity ∈ webhook.severities)
AND
(webhook.categoryIds is empty OR report.categoryId ∈ webhook.categoryIds)
```

Empty set = "all". Example: critical-only webhook with empty categories → every
critical report. Per-category webhooks → route Engineering vs Marketing to
different channels.

---

## 1. Data model (migration `0007_*`)

Two new enums: `webhook_format`, `webhook_delivery_status`.

### `webhooks` — config

| col           | type                | notes                                                       |
| ------------- | ------------------- | ----------------------------------------------------------- |
| `id`          | text PK             | `wh_*`                                                      |
| `workspaceId` | text FK→workspaces  | scoping (cascade delete)                                    |
| `name`        | text                | human label                                                 |
| `url`         | text                | target endpoint                                             |
| `format`      | `webhook_format`    | `generic` (default) \| `slack` \| `discord` \| `mattermost` |
| `secret`      | text                | HMAC key, server-generated, returned once                   |
| `severities`  | `report_severity[]` | reuse existing enum; empty `{}` = all severities            |
| `categoryIds` | text[]              | empty `{}` = all categories in workspace                    |
| `enabled`     | bool default true   | pause without delete                                        |
| `createdAt`   | timestamptz         |                                                             |
| `updatedAt`   | timestamptz         |                                                             |

Index: `webhooks(workspaceId)`.

### `webhook_deliveries` — durable queue + log

| col              | type                      | notes                                     |
| ---------------- | ------------------------- | ----------------------------------------- |
| `id`             | text PK                   | `whd_*`                                   |
| `webhookId`      | text FK→webhooks          | cascade delete                            |
| `reportId`       | text FK→reports           | `ON DELETE SET NULL` (survives retention) |
| `status`         | `webhook_delivery_status` | `pending\|delivering\|success\|failed`    |
| `attempts`       | int default 0             |                                           |
| `maxAttempts`    | int default 5             |                                           |
| `nextAttemptAt`  | timestamptz               | backoff schedule; worker polls this       |
| `lastStatusCode` | int null                  | last HTTP response code                   |
| `lastError`      | text null                 | error / response-body snippet             |
| `payload`        | jsonb                     | **frozen vendor-shaped body** (snapshot)  |
| `createdAt`      | timestamptz               |                                           |
| `deliveredAt`    | timestamptz null          |                                           |

Indexes:

- `webhook_deliveries(status, nextAttemptAt)` — worker claim query.
- `webhook_deliveries(webhookId, createdAt DESC)` — delivery-log UI.

**Why snapshot payload:** reports are purged by per-account retention. Snapshot
freezes the formatted body so delivery + log survive report purge, and the
envelope/format version is locked at enqueue time. `reportId` is `SET NULL` so
the FK does not block purge.

---

## 2. Matching + enqueue (in-process, on ingestion)

New subscriber attached at `app.ingestionBus.onReportIngested()` (in
`server.ts`, beside realtime fanout). Per event:

1. Load **enabled** webhooks for `event.workspaceId` (cached per-workspace,
   short TTL, invalidated on webhook CRUD — avoids one query per report).
2. Filter by the matching rule above.
3. For each match: run the target formatter (see §4), insert a
   `webhook_deliveries` row (`status=pending`, `nextAttemptAt=now`, frozen
   `payload`). The insert is the durable handoff; the subscriber does **no HTTP**.

Enqueue is cheap and non-blocking → ingestion latency unaffected.

**Cloud (multi-replica):** ingestion + enqueue run on the same replica that
received the report POST, via the in-process bus — so this works without the
Phase-10 Redis bus. Delivery is decoupled (see §3).

---

## 3. Delivery engine (`webhooks/runner.ts`)

Background poller mirroring the retention-runner lifecycle. Interval
`WEBHOOK_POLL_INTERVAL_MS` (default ~2000ms). Started in `index.ts` after the
server listens; stopped on `onClose`.

1. **Claim batch** (multi-replica safe):
   ```sql
   SELECT … FROM webhook_deliveries
   WHERE status IN ('pending','failed') AND next_attempt_at <= now()
   ORDER BY next_attempt_at
   FOR UPDATE SKIP LOCKED
   LIMIT :batch
   ```
   Set claimed rows to `status='delivering'`. `SKIP LOCKED` (not a single
   advisory lock) lets N replicas deliver in parallel with no double-send.
2. **POST** `payload` verbatim. Timeout ~10s via `AbortController`. Headers:
   - `Content-Type: application/json`
   - `X-PulseDeck-Event`, `X-PulseDeck-Delivery: <deliveryId>`
   - `X-PulseDeck-Timestamp`
   - `X-PulseDeck-Signature: sha256=<HMAC-SHA256(secret, rawBody)>` — **generic
     format only** (vendor targets don't verify it).
3. **Result:**
   - 2xx → `status=success`, set `deliveredAt`, `lastStatusCode`.
   - else → `attempts++`; if `attempts >= maxAttempts` → terminal `failed`,
     else `failed` + `nextAttemptAt = now + backoff(attempts)`.
   - Backoff: exponential with jitter, e.g. 10s → 1m → 5m → 30m → 2h.
4. **SSRF re-check before send** (DNS-rebinding defense): re-resolve URL; if it
   resolves to a blocked range under current policy → terminal `failed` with
   `lastError`.

---

## 4. Envelope + formatters

Per-webhook `format` selects a **pure** formatter run at enqueue time; its
output is frozen into `payload`.

```ts
interface WebhookFormatter {
  format(event: WebhookEvent): { body: unknown; headers?: Record<string, string> };
  signs: boolean; // generic → true; vendors → false
}
const FORMATTERS: Record<WebhookFormat, WebhookFormatter> = {
  generic,
  slack,
  discord,
  mattermost,
};
```

### `generic` (default) — versioned envelope, HMAC-signed

```jsonc
{
  "event": "report.created",
  "version": "1",
  "deliveryId": "whd_…",
  "workspace": { "id": "ws_…", "slug": "…" },
  "category": { "id": "cat_…", "name": "Engineering" },
  "stream": { "id": "str_…", "slug": "…", "name": "…" },
  "report": {
    "id": "rep_…",
    "title": "…",
    "summary": "…",
    "severity": "critical",
    "tags": ["…"],
    "occurredAt": "…",
    "receivedAt": "…",
    "blocks": [
      /* @pulsedeck/schema Block[] */
    ],
  },
}
```

`version` lets the envelope evolve without breaking consumers.

### Vendor formats

- `slack` → `{ text, blocks:[…] }`, severity-colored, title/summary + link back
  to the report.
- `mattermost` → Slack-compatible payload; reuse the slack formatter (alias).
- `discord` → `{ content, embeds:[{ title, description, color, fields }] }`,
  color mapped from severity.

Vendor targets set `signs:false` → no signature header. `secret` is meaningful
only for `generic`; UI hides the secret/rotate controls for vendor formats.
Adding a 5th target later = one formatter + enum value; no schema/worker change.

---

## 5. API surface (`routes/webhooks.ts`)

Gated by new RBAC action `webhooks:manage` (owner/admin). Workspace-scoped.

| Method + path                                                | Purpose                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `POST   /api/v1/workspaces/:id/webhooks`                     | create; validate URL+SSRF, enforce `max_webhooks`, generate secret, **return secret once** |
| `GET    /api/v1/workspaces/:id/webhooks`                     | list (no secret)                                                                           |
| `GET    /api/v1/workspaces/:id/webhooks/:whId`               | detail (no secret)                                                                         |
| `PATCH  /api/v1/workspaces/:id/webhooks/:whId`               | update name/url/format/severities/categoryIds/enabled                                      |
| `POST   /api/v1/workspaces/:id/webhooks/:whId/rotate-secret` | new secret, returned once                                                                  |
| `DELETE /api/v1/workspaces/:id/webhooks/:whId`               | cascade-delete deliveries                                                                  |
| `POST   /api/v1/workspaces/:id/webhooks/:whId/test`          | enqueue a synthetic test delivery                                                          |
| `GET    /api/v1/workspaces/:id/webhooks/:whId/deliveries`    | keyset-paginated delivery log                                                              |

Request/response validation follows the existing zod / `@pulsedeck/schema`
pattern. Secret is returned **only** on create + rotate-secret.

---

## 6. Web UI (workspace settings)

- **Webhooks list** — name, URL host, format badge, enabled toggle,
  last-delivery status badge.
- **Create/edit dialog** — name, URL, format dropdown, severity multi-select
  (reuse the multi-severity component from commit `4ed88ad`), category
  multi-select (empty = all), enabled toggle. Secret shown once on
  create/rotate with copy button; secret block hidden for vendor formats.
- **Delivery-log drawer** — recent deliveries per webhook: status, HTTP code,
  attempts, error, timestamps; redeliver button (re-enqueues).
- Gated on `webhooks:manage` + capabilities; hidden for viewers/editors.

---

## 7. Cloud-readiness

- **Multi-replica delivery** — durable `webhook_deliveries` table + claim via
  `FOR UPDATE SKIP LOCKED`. Enqueue rides the in-process bus on the ingesting
  replica; delivery is independent and parallel across replicas.
- **Per-account limits** — create enforces `max_webhooks` via
  `getAccountLimits(accountId)`; `null` = unlimited (OSS unaffected). Column
  added to billing accounts by cloud later; OSS leaves it null. No override
  interface (reader only), per the configurability plan.
- **SSRF policy** — `WEBHOOK_ALLOW_PRIVATE_IPS` runtime config: default `true`
  for `self-host` (internal Slack/services), `false` for `cloud`. Enforced at
  create AND send (DNS-rebinding safe).
- **Secret at rest** — OSS stores plaintext (needed to sign). Cloud column
  encryption is a future seam (app-key crypto on `secret`); **not built now**.
- **Formatters** — pure, no per-tenant state, no new infra.

---

## 8. Security

- HMAC-SHA256 over raw body (generic); documented verification recipe;
  timestamp header for replay-window checks.
- SSRF block list (loopback, private ranges, `169.254.169.254` metadata)
  enforced at create + send; policy via `WEBHOOK_ALLOW_PRIVATE_IPS`.
- Secret shown once; never returned by list/detail; rotate endpoint.
- Outbound timeout + capped retries (no infinite retry amplification).
- Owner/admin only; workspace-scoped queries (no cross-tenant leak).

---

## 9. Config (env / runtime)

| Var                           | Default      | Notes                           |
| ----------------------------- | ------------ | ------------------------------- |
| `WEBHOOK_POLL_INTERVAL_MS`    | `2000`       | delivery poller cadence         |
| `WEBHOOK_MAX_ATTEMPTS`        | `5`          | per-delivery cap                |
| `WEBHOOK_DELIVERY_TIMEOUT_MS` | `10000`      | outbound POST timeout           |
| `WEBHOOK_ALLOW_PRIVATE_IPS`   | mode-derived | `true` self-host, `false` cloud |
| `WEBHOOK_BATCH_SIZE`          | `20`         | rows claimed per poll           |

Routed through `config/runtime.ts` (no raw `process.env` in feature code).

---

## 10. Testing

- **Matching** — severity/category set logic incl. empty-set "all".
- **Formatters** — snapshot tests of generic/slack/discord/mattermost bodies.
- **Signing** — HMAC value + header presence per format.
- **Delivery engine** — success, retry/backoff, terminal-fail at max attempts,
  claim concurrency (`SKIP LOCKED` no double-send).
- **SSRF** — blocked ranges rejected at create + send under each policy.
- **API** — RBAC gating, secret-once, limit enforcement, delivery-log paging.
- **Retention** — delivery row + payload survive report purge (reportId nulled).
