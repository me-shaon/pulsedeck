import type { Report } from '../db/index.js';
import type { Webhook } from '../db/schema/webhooks.js';

/**
 * The enriched, self-contained context a formatter turns into a delivery body.
 *
 * Built once per matched report at enqueue time: the ingestion event carries
 * only ids, so the enqueuer resolves the workspace slug + category/stream labels
 * the vendor messages want to display. `deliveryId` is the id of the
 * `webhook_deliveries` row this body belongs to (also echoed back in the
 * delivery headers so a consumer can correlate).
 */
export interface WebhookEvent {
  deliveryId: string;
  workspace: { id: string; slug: string };
  category: { id: string; name: string };
  stream: { id: string; slug: string; name: string };
  report: Report;
}

/** Optional rendering inputs available to every formatter. */
export interface FormatterContext {
  /** Public base URL of the web app, when known — used to build report permalinks. */
  appBaseUrl?: string;
}

/** What a formatter produces: the exact body to POST + any extra headers. */
export interface FormattedDelivery {
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * A pure mapping from an event to a vendor-shaped body. `signs` decides whether
 * the runner adds the HMAC signature header: only the generic envelope is
 * verifiable by the consumer; vendor endpoints authenticate via the secret URL.
 */
export interface WebhookFormatter {
  signs: boolean;
  format(event: WebhookEvent, ctx: FormatterContext): FormattedDelivery;
}

/** A claimed delivery joined with the parent webhook's send-time fields. */
export interface ClaimedDelivery {
  id: string;
  webhookId: string;
  attempts: number;
  maxAttempts: number;
  payload: unknown;
  url: string;
  secret: string;
  format: Webhook['format'];
}
