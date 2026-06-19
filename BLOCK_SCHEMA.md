# PulseDeck Block Schema — v1

The wire contract for reports pushed into PulseDeck. Implemented once in `packages/schema`
(Zod): the backend validates with it, the frontend renders with it, and the agent setup
prompt embeds it.

**Stability:** additive changes only within 1.x (new optional fields, new block types, new
enum values). Fields are never renamed or repurposed. Breaking changes require a new major
version. Agents fetch the current schema at `GET /api/v1/schema`.

---

## 1. Canonical Enums

Defined once. Every block and report references these. Validation rejects any other value.

```ts
severity      = "info" | "warning" | "critical"                       // report + alert block
status        = "healthy" | "degraded" | "down" | "unknown"           // status block, timeline events
trend         = "up" | "down" | "flat"                                // metric direction (geometry)
sentiment     = "positive" | "negative" | "neutral"                   // metric color meaning
format        = "number" | "currency" | "percent" | "bytes" | "duration"  // metric/table number format
chart_variant = "line" | "bar" | "area"
column_type   = "string" | "number" | "date"                         // table column typing for sort
```

`trend` and `sentiment` are separate on purpose: `trend` is geometry (the arrow), `sentiment`
is meaning (the color). Latency up is negative; revenue up is positive. Agents set both.

---

## 2. Common Block Envelope

Every block carries these fields. The renderer reads the envelope first, then type-specific fields.

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique within the report. Enables anchoring, dedup, cross-references. |
| `type` | yes | One of the 8 block types. |
| `title` | no | Section heading for the block. |
| `caption` | no | Small muted subtext under the block. |

```jsonc
{
  "id": "blk_7f3a",
  "type": "metric",
  "title": "API Latency",
  "caption": "P95, prod"
}
```

Rendering is flat and sequential. No block nesting in v1.

---

## 3. Ingestion Limits

Enforced at ingestion; exceeding any limit returns `422` with the offending `issues[]` path.

| Limit | Value |
|---|---|
| blocks per report | 50 |
| table rows | 1000 |
| table columns | 20 |
| chart series | 10 |
| chart points per series | 500 |
| markdown length | 50,000 chars |
| payload size | 1 MB |

---

## 4. Block Types

### 4.1 metric

| Field | Required | Description |
|---|---|---|
| `key` | yes | Stable machine id, constant across reports. Dashboard widgets select a series by `key`, never by `label`. |
| `label` | yes | Human display name. |
| `value` | yes | Number. |
| `unit` | no | Unit suffix (e.g. `ms`). |
| `format` | no | `format` enum, default `number`. |
| `precision` | no | Decimal places. |
| `trend` | no | `trend` enum. |
| `sentiment` | no | `sentiment` enum. |
| `delta` | no | Change vs comparison. |
| `comparison_label` | no | Label for the comparison (e.g. `vs yesterday`). |

```jsonc
{
  "id": "blk_lat",
  "type": "metric",
  "key": "api_latency_p95",
  "label": "Avg API Latency",
  "value": 421,
  "unit": "ms",
  "format": "duration",
  "precision": 0,
  "trend": "up",
  "sentiment": "negative",
  "delta": 14,
  "comparison_label": "vs yesterday"
}
```

### 4.2 markdown

| Field | Required | Description |
|---|---|---|
| `content` | yes | Markdown string. Rendered with raw HTML disabled (react-markdown `skipHtml`, no `rehype-raw`) as an XSS guard. |

```jsonc
{
  "id": "blk_sum",
  "type": "markdown",
  "content": "# Summary\nLatency increased **14%**."
}
```

### 4.3 chart

| Field | Required | Description |
|---|---|---|
| `variant` | yes | `chart_variant` enum. |
| `title` | no | Chart title. |
| `labels` | yes | X-axis values. ISO 8601 timestamps allowed for time-series. |
| `x_axis` | no | X-axis label. |
| `y_axis` | no | Y-axis label. |
| `unit` | no | Series unit. |
| `series` | yes | Array of `{ name, data[] }`. `data` length matches `labels`. |

```jsonc
{
  "id": "blk_vol",
  "type": "chart",
  "variant": "line",
  "title": "Request Volume",
  "labels": ["Mon", "Tue", "Wed"],
  "x_axis": "Day",
  "y_axis": "Requests",
  "unit": "req",
  "series": [{ "name": "Requests", "data": [120, 145, 98] }]
}
```

### 4.4 table

Typed columns + keyed rows so sorting respects real types (number `890`, not string `"890ms"`)
and column reordering stays safe.

| Field | Required | Description |
|---|---|---|
| `columns` | yes | Array of `{ key, label, type, unit? }`. `type` is a `column_type`. |
| `rows` | yes | Array of objects keyed by column `key`. |

```jsonc
{
  "id": "blk_svc",
  "type": "table",
  "columns": [
    { "key": "service", "label": "Service", "type": "string" },
    { "key": "latency", "label": "Latency", "type": "number", "unit": "ms" }
  ],
  "rows": [
    { "service": "API",    "latency": 42 },
    { "service": "Worker", "latency": 890 }
  ]
}
```

### 4.5 timeline

| Field | Required | Description |
|---|---|---|
| `events` | yes | Array of events. |
| `events[].time` | yes | ISO 8601 timestamp. |
| `events[].label` | yes | Event label. |
| `events[].description` | no | Detail text. |
| `events[].status` | no | `status` enum. |

```jsonc
{
  "id": "blk_dep",
  "type": "timeline",
  "events": [
    { "time": "2026-05-22T09:00:00Z", "label": "Deploy started", "description": "v2.1", "status": "healthy" },
    { "time": "2026-05-22T09:04:00Z", "label": "Deploy complete", "status": "healthy" }
  ]
}
```

### 4.6 alert

| Field | Required | Description |
|---|---|---|
| `severity` | yes | `severity` enum. |
| `title` | yes | Alert title. |
| `message` | no | Alert detail. |

```jsonc
{
  "id": "blk_alrt",
  "type": "alert",
  "severity": "warning",
  "title": "High latency detected",
  "message": "P95 exceeded 500ms threshold."
}
```

### 4.7 status

| Field | Required | Description |
|---|---|---|
| `items` | yes | Array of `{ key, label, status }`. `key` makes each item addressable by dashboard widgets; `status` is a `status` enum. |

```jsonc
{
  "id": "blk_stat",
  "type": "status",
  "items": [
    { "key": "api",    "label": "API",    "status": "healthy" },
    { "key": "worker", "label": "Worker", "status": "degraded" }
  ]
}
```

### 4.8 artifact

Drill-down link to the full underlying data. PulseDeck surfaces the intelligence; the source
system holds the raw data.

| Field | Required | Description |
|---|---|---|
| `label` | yes | Display label for the link. |
| `url` | yes | Link target. |
| `mime_type` | no | MIME type hint. |
| `size_bytes` | no | File size. |

```jsonc
{
  "id": "blk_pdf",
  "type": "artifact",
  "label": "Full Audit Report",
  "url": "https://storage.example.com/audit.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 184320
}
```

Rendered as `<a rel="noopener noreferrer" target="_blank">`. The URL is shown as a link only
and never fetched server-side (SSRF guard).

---

## 5. Versioning

- The report envelope carries `version: "1.0"`.
- Within 1.x, changes are additive: new optional fields, new block types, new enum values.
  Agents tolerate unknown enum values by rendering them as `unknown`.
- Renaming or removing a field or enum value is a major (2.0) change.
- `GET /api/v1/schema` returns the current schema and version for self-update.

---

## 6. Deferred (not in v1)

- `pie` / `donut` chart variants
- `group` / `columns` layout blocks (rendering stays flat in v1)
- `code` / `diff` block
- per-cell table formatting objects
- custom / registry block types
