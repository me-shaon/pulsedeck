import { describe, expect, it } from 'vitest';
import type { Report } from '../src/db/index.js';
import type { Webhook } from '../src/db/schema/webhooks.js';
import { matches } from '../src/webhooks/enqueue.js';
import { ENVELOPE_VERSION, formatForWebhook } from '../src/webhooks/formatters.js';
import { signBody, verifySignature, generateWebhookSecret } from '../src/webhooks/signing.js';
import { fetch as undiciFetch } from 'undici';
import { createWebhookDispatcher, guardedFetch } from '../src/webhooks/safe-fetch.js';
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

  it('flags IPv4-mapped IPv6 in both dotted and hex form (H5 bypass)', () => {
    // ::ffff:169.254.169.254 — the metadata endpoint via a mapped address.
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true); // dotted form
    expect(isBlockedIp('::ffff:a9fe:a9fe')).toBe(true); // hex form (the bypass)
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:7f00:1')).toBe(true); // 127.0.0.1, hex
    expect(isBlockedIp('::ffff:10.0.0.1')).toBe(true);
    // IPv4-mapped public address stays allowed.
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('flags NAT64, ULA and link-local; allows public IPv6', () => {
    expect(isBlockedIp('64:ff9b::169.254.169.254')).toBe(true); // NAT64 → metadata
    expect(isBlockedIp('fc00::1')).toBe(true); // unique-local
    expect(isBlockedIp('fe80::1')).toBe(true); // link-local
    expect(isBlockedIp('::')).toBe(true); // unspecified
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false); // public (Cloudflare)
    expect(isBlockedIp('not-an-ip::garbage')).toBe(true); // unparseable → fail closed
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

describe('guardedFetch — redirect re-validation (C4)', () => {
  // Build a fetch stub that replays a queue of [status, location?] per call and
  // records the URLs it was asked to fetch.
  function stubFetch(steps: Array<{ status: number; location?: string }>) {
    const urls: string[] = [];
    let i = 0;
    const impl = (async (url: string | URL) => {
      urls.push(String(url));
      const step = steps[Math.min(i++, steps.length - 1)];
      const headers = step.location ? { location: step.location } : undefined;
      return new Response(null, { status: step.status, headers });
    }) as unknown as typeof fetch;
    return { impl, urls };
  }

  it('follows a redirect to a public target and returns the final response', async () => {
    const { impl, urls } = stubFetch([
      { status: 302, location: 'https://hooks.example.com/final' },
      { status: 200 },
    ]);
    const res = await guardedFetch(
      'https://hooks.example.com/start',
      { method: 'POST' },
      { fetchImpl: impl, allowPrivateIps: true },
    );
    expect(res.status).toBe(200);
    expect(urls).toEqual(['https://hooks.example.com/start', 'https://hooks.example.com/final']);
  });

  it('rejects a redirect that points at an internal address (cloud policy)', async () => {
    const { impl } = stubFetch([
      { status: 302, location: 'http://169.254.169.254/latest/meta-data/' },
      { status: 200 },
    ]);
    // Start at a public literal so hop 0 passes, then the 3xx aims internal.
    await expect(
      guardedFetch(
        'http://1.1.1.1/hook',
        { method: 'POST' },
        { fetchImpl: impl, allowPrivateIps: false },
      ),
    ).rejects.toBeInstanceOf(WebhookUrlError);
  });

  it('fails terminally on an over-long redirect chain', async () => {
    const { impl } = stubFetch([{ status: 302, location: 'http://1.1.1.1/next' }]); // always 302
    await expect(
      guardedFetch(
        'http://1.1.1.1/start',
        { method: 'POST' },
        {
          fetchImpl: impl,
          allowPrivateIps: false,
          maxRedirects: 2,
        },
      ),
    ).rejects.toThrow(/redirects/);
  });

  it('connect-time pin refuses a hostname that resolves private (C3, real undici)', async () => {
    // `localhost` resolves to 127.0.0.1/::1; the connector lookup must reject it
    // before any socket — surfacing as a WebhookUrlError, not a connection error.
    const dispatcher = createWebhookDispatcher(false);
    await expect(
      guardedFetch(
        'http://localhost/hook',
        { method: 'POST' },
        {
          fetchImpl: undiciFetch as unknown as typeof fetch,
          dispatcher,
          allowPrivateIps: false,
        },
      ),
    ).rejects.toBeInstanceOf(WebhookUrlError);
    await dispatcher?.close();
  });
});
