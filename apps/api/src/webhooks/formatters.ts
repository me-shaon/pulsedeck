import type { WebhookFormat } from '../db/index.js';
import type {
  FormatterContext,
  FormattedDelivery,
  WebhookEvent,
  WebhookFormatter,
} from './types.js';

/**
 * Payload formatters (PRD "Webhooks — payload formats").
 *
 * Each is a PURE function from a {@link WebhookEvent} to the exact body a target
 * expects. The generic envelope is our own versioned contract (HMAC-signed);
 * the vendor formatters render native Slack / Discord messages so a webhook URL
 * pasted from those products works with no glue. The formatter runs at enqueue
 * time and its output is frozen into the delivery row.
 */

/** Envelope schema version. Bump on a breaking change to the generic shape. */
export const ENVELOPE_VERSION = '1';
const EVENT_NAME = 'report.created';

/** Per-severity accent: hex for Slack, the same value as int for Discord. */
const SEVERITY_HEX: Record<string, string> = {
  critical: '#e5484d', // red
  warning: '#f5a623', // amber
  info: '#0091ff', // blue
};
const DEFAULT_HEX = '#8b8d98'; // neutral grey when severity is null/unknown

function hexFor(severity: string | null): string {
  return (severity && SEVERITY_HEX[severity]) || DEFAULT_HEX;
}

function severityLabel(severity: string | null): string {
  return (severity ?? 'info').toUpperCase();
}

function iso(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

/** Best-effort permalink to the report in the web app (omitted if base unknown). */
function permalink(event: WebhookEvent, ctx: FormatterContext): string | undefined {
  if (!ctx.appBaseUrl) return undefined;
  const base = ctx.appBaseUrl.replace(/\/+$/, '');
  return `${base}/workspaces/${event.workspace.slug}/reports/${event.report.id}`;
}

const generic: WebhookFormatter = {
  signs: true,
  format(event: WebhookEvent, ctx: FormatterContext): FormattedDelivery {
    const r = event.report;
    return {
      body: {
        event: EVENT_NAME,
        version: ENVELOPE_VERSION,
        deliveryId: event.deliveryId,
        workspace: { id: event.workspace.id, slug: event.workspace.slug },
        category: { id: event.category.id, name: event.category.name },
        stream: { id: event.stream.id, slug: event.stream.slug, name: event.stream.name },
        report: {
          id: r.id,
          title: r.title,
          summary: r.summary,
          severity: r.severity ?? null,
          tags: r.tags,
          occurredAt: iso(r.occurredAt),
          receivedAt: iso(r.receivedAt),
          blocks: r.blocks,
          url: permalink(event, ctx),
        },
      },
    };
  },
};

const slack: WebhookFormatter = {
  signs: false,
  format(event: WebhookEvent, ctx: FormatterContext): FormattedDelivery {
    const r = event.report;
    const link = permalink(event, ctx);
    const title = link ? `<${link}|${r.title}>` : r.title;
    const fields = [
      { title: 'Severity', value: severityLabel(r.severity), short: true },
      { title: 'Category', value: event.category.name, short: true },
      { title: 'Stream', value: event.stream.name, short: true },
    ];
    if (r.tags.length > 0) fields.push({ title: 'Tags', value: r.tags.join(', '), short: false });
    return {
      body: {
        text: `*[${severityLabel(r.severity)}]* ${title}`,
        attachments: [
          {
            color: hexFor(r.severity),
            ...(r.summary ? { text: r.summary } : {}),
            fields,
            footer: 'PulseDeck',
          },
        ],
      },
    };
  },
};

// Mattermost ingests the Slack incoming-webhook payload verbatim, so it reuses
// the Slack formatter — one renderer, two targets.
const mattermost: WebhookFormatter = { signs: false, format: slack.format };

const discord: WebhookFormatter = {
  signs: false,
  format(event: WebhookEvent, ctx: FormatterContext): FormattedDelivery {
    const r = event.report;
    const link = permalink(event, ctx);
    const fields = [
      { name: 'Severity', value: severityLabel(r.severity), inline: true },
      { name: 'Category', value: event.category.name, inline: true },
      { name: 'Stream', value: event.stream.name, inline: true },
    ];
    if (r.tags.length > 0) fields.push({ name: 'Tags', value: r.tags.join(', '), inline: false });
    return {
      body: {
        content: `**[${severityLabel(r.severity)}]** ${r.title}`,
        embeds: [
          {
            title: r.title,
            ...(link ? { url: link } : {}),
            ...(r.summary ? { description: r.summary } : {}),
            color: parseInt(hexFor(r.severity).slice(1), 16),
            fields,
          },
        ],
      },
    };
  },
};

/** Registry keyed by the `webhook_format` enum. */
export const FORMATTERS: Record<WebhookFormat, WebhookFormatter> = {
  generic,
  slack,
  discord,
  mattermost,
};

/** Format an event for a webhook's chosen target. */
export function formatForWebhook(
  format: WebhookFormat,
  event: WebhookEvent,
  ctx: FormatterContext,
): FormattedDelivery {
  return FORMATTERS[format].format(event, ctx);
}
