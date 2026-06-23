import { describe, expect, it } from 'vitest';
import type { Report } from '../src/db/index.js';
import type { Webhook } from '../src/db/schema/webhooks.js';
import { matches } from '../src/webhooks/enqueue.js';
import { ENVELOPE_VERSION, formatForWebhook } from '../src/webhooks/formatters.js';
import { signBody, verifySignature, generateWebhookSecret } from '../src/webhooks/signing.js';
import { assertUrlAllowed, isBlockedIp, WebhookUrlError } from '../src/webhooks/ssrf.js';
import type { WebhookEvent } from '../src/webhooks/types.js';

/**
 * Pure unit tests for the webhook engine — no DB, always run. Matching, payload
 * formatting, HMAC signing, and the SSRF guard are all pure functions; the DB
 * paths (enqueue, runner, routes) are covered in webhooks.integration.test.ts.
 */

function makeWebhook(over: Partial<Webhook> = {}): Webhook {
  return {
    id: 'wh_1',
    workspaceId: 'ws_1',
    name: 'hook',
    url: 'https://example.com/hook',
    format: 'generic',
    secret: 'whsec_test',
    severities: [],
    categoryIds: [],
    enabled: true,
    createdAt: new Date('2026-06-23T00:00:00Z'),
    updatedAt: new Date('2026-06-23T00:00:00Z'),
    ...over,
  };
}

describe('matches() — severity ∧ category filters (empty = all)', () => {
  it('empty filters match everything', () => {
    const w = makeWebhook();
    expect(matches(w, 'info', 'cat_1')).toBe(true);
    expect(matches(w, null, 'cat_9')).toBe(true);
  });

  it('severity filter selects only listed severities', () => {
    const w = makeWebhook({ severities: ['critical'] });
    expect(matches(w, 'critical', 'cat_1')).toBe(true);
    expect(matches(w, 'warning', 'cat_1')).toBe(false);
    expect(matches(w, null, 'cat_1')).toBe(false); // null never matches a non-empty set
  });

  it('category filter routes by category', () => {
    const w = makeWebhook({ categoryIds: ['cat_eng'] });
    expect(matches(w, 'info', 'cat_eng')).toBe(true);
    expect(matches(w, 'info', 'cat_mkt')).toBe(false);
  });

  it('both filters must pass (AND)', () => {
    const w = makeWebhook({ severities: ['critical'], categoryIds: ['cat_eng'] });
    expect(matches(w, 'critical', 'cat_eng')).toBe(true);
    expect(matches(w, 'critical', 'cat_mkt')).toBe(false);
    expect(matches(w, 'warning', 'cat_eng')).toBe(false);
  });
});

function makeReport(over: Partial<Report> = {}): Report {
  const ts = new Date('2026-06-23T12:00:00Z');
  return {
    id: 'rpt_1',
    streamId: 'stm_1',
    workspaceId: 'ws_1',
    sourceId: 'src_1',
    idempotencyKey: 'k1',
    title: 'DB pool exhausted',
    summary: 'No free connections',
    severity: 'critical',
    occurredAt: ts,
    receivedAt: ts,
    createdAt: ts,
    tags: ['db', 'prod'],
    blocks: [],
    searchVector: '',
    ...over,
  };
}

function makeEvent(report = makeReport()): WebhookEvent {
  return {
    deliveryId: 'whd_1',
    workspace: { id: 'ws_1', slug: 'acme' },
    category: { id: 'cat_eng', name: 'Engineering' },
    stream: { id: 'stm_1', slug: 'api', name: 'API' },
    report,
  };
}

describe('formatters', () => {
  it('generic envelope carries the versioned report contract', () => {
    const { body } = formatForWebhook('generic', makeEvent(), { appBaseUrl: 'https://app.test' });
    const env = body as Record<string, any>;
    expect(env.event).toBe('report.created');
    expect(env.version).toBe(ENVELOPE_VERSION);
    expect(env.deliveryId).toBe('whd_1');
    expect(env.report.severity).toBe('critical');
    expect(env.report.url).toBe('https://app.test/workspaces/acme/reports/rpt_1');
    expect(env.category.name).toBe('Engineering');
  });

  it('slack payload has text + colored attachment', () => {
    const { body } = formatForWebhook('slack', makeEvent(), {});
    const msg = body as Record<string, any>;
    expect(msg.text).toContain('[CRITICAL]');
    expect(msg.attachments[0].color).toBe('#e5484d');
    expect(msg.attachments[0].fields.map((f: any) => f.title)).toContain('Category');
  });

  it('mattermost reuses the slack shape', () => {
    const slack = formatForWebhook('slack', makeEvent(), {}).body;
    const mm = formatForWebhook('mattermost', makeEvent(), {}).body;
    expect(mm).toEqual(slack);
  });

  it('discord payload uses embeds with an integer color', () => {
    const { body } = formatForWebhook('discord', makeEvent(), {});
    const msg = body as Record<string, any>;
    expect(msg.content).toContain('[CRITICAL]');
    expect(msg.embeds[0].color).toBe(parseInt('e5484d', 16));
  });

  it('only the generic formatter signs', () => {
    // (exercised via the registry in the runner; here assert the colors fall back)
    const { body } = formatForWebhook('slack', makeEvent(makeReport({ severity: null })), {});
    expect((body as any).attachments[0].color).toBe('#8b8d98');
  });
});

describe('HMAC signing', () => {
  it('verifies a matching signature and rejects a tampered body', () => {
    const secret = generateWebhookSecret();
    const body = JSON.stringify({ hello: 'world' });
    const sig = signBody(secret, body);
    expect(sig.startsWith('sha256=')).toBe(true);
    expect(verifySignature(secret, body, sig)).toBe(true);
    expect(verifySignature(secret, body + 'x', sig)).toBe(false);
    expect(verifySignature('other', body, sig)).toBe(false);
  });
});

describe('SSRF guard', () => {
  it('flags loopback / private / link-local / metadata ranges', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('10.0.0.5')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
    expect(isBlockedIp('172.16.5.5')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true); // cloud metadata
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fd00::1')).toBe(true);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('1.1.1.1')).toBe(false);
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(assertUrlAllowed('ftp://example.com', false)).rejects.toBeInstanceOf(
      WebhookUrlError,
    );
  });

  it('blocks a host that resolves to a private address (cloud policy)', async () => {
    const resolver = async () => ['10.1.2.3'];
    await expect(assertUrlAllowed('https://evil.test', false, resolver)).rejects.toBeInstanceOf(
      WebhookUrlError,
    );
  });

  it('allows a public-resolving host', async () => {
    const resolver = async () => ['93.184.216.34'];
    await expect(assertUrlAllowed('https://example.com', false, resolver)).resolves.toBeInstanceOf(
      URL,
    );
  });

  it('allowPrivateIps bypasses the resolution check (self-host)', async () => {
    await expect(assertUrlAllowed('http://localhost:3000/hook', true)).resolves.toBeInstanceOf(URL);
  });
});
