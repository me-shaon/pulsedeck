#!/usr/bin/env node
/**
 * pulsedeck-demo — the one-command demo agent.
 *
 * Registers as a PulseDeck source and pushes realistic, varied fake reports on
 * an interval so a brand-new dashboard fills in under two minutes. It speaks the
 * PUBLIC HTTP protocol exactly like a third-party agent: zero app-internal
 * imports, zero runtime dependencies, just Node 22 built-ins (`fetch`,
 * `crypto.randomUUID`).
 *
 * Usage:
 *   pulsedeck-demo --url <BASE_URL> --token <reg_xxx> [--interval <ms>] [--once]
 *
 * Flow:
 *   1. POST {url}/api/v1/sources/register   (X-Registration-Token)  → api_key
 *   2. loop: POST {url}/api/v1/reports       (Bearer + Idempotency-Key)
 *      201 ✓ · 200 dup · 422 print issues+exit · 429 back off · 401/403/409 stop
 */

import { randomUUID } from 'node:crypto';
import { TEMPLATES, type ReportInput } from './templates.js';

const SCHEMA_VERSION = '1.0';
const AGENT_NAME = 'PulseDeck Demo Agent';
const AGENT_VERSION = '1.0.0';
const DEFAULT_INTERVAL_MS = 30_000;

interface CliOptions {
  url: string;
  token: string;
  interval: number;
  once: boolean;
}

const USAGE = `
pulsedeck-demo — push realistic demo reports into PulseDeck over the real protocol.

Usage:
  pulsedeck-demo --url <BASE_URL> --token <reg_xxx> [--interval <ms>] [--once]

Options:
  --url <BASE_URL>    Base URL of the PulseDeck API (e.g. http://localhost:3001).
  --token <reg_xxx>   One-time registration token from "Add source" in the dashboard.
  --interval <ms>     Delay between pushes (default ${DEFAULT_INTERVAL_MS}). Ignored with --once.
  --once              Register and push exactly one report, then exit.
  -h, --help          Show this help.

Example:
  pulsedeck-demo --url http://localhost:3001 --token reg_abc123 --interval 15000
`.trim();

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  const opts: Partial<CliOptions> & { once: boolean } = { once: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      case '--url':
        opts.url = argv[++i];
        break;
      case '--token':
        opts.token = argv[++i];
        break;
      case '--interval': {
        const raw = argv[++i];
        const ms = Number(raw);
        if (!Number.isFinite(ms) || ms < 250) {
          fail(`--interval must be a number ≥ 250 (got "${raw ?? ''}").`);
        }
        opts.interval = ms;
        break;
      }
      case '--once':
        opts.once = true;
        break;
      default:
        fail(`Unknown argument "${arg}".`);
    }
  }

  if (!opts.url) fail('Missing required --url.');
  if (!opts.token) fail('Missing required --token.');
  try {
    // Normalize: strip a trailing slash so URL concatenation is clean.
    opts.url = new URL(opts.url).origin + new URL(opts.url).pathname.replace(/\/$/, '');
  } catch {
    fail(`--url is not a valid URL: "${opts.url}".`);
  }

  return {
    url: opts.url,
    token: opts.token,
    interval: opts.interval ?? DEFAULT_INTERVAL_MS,
    once: opts.once,
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers (typed, no `any`).
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { __raw: text };
  }
}

/** A single ingestion validation issue (422). */
interface Issue {
  path?: unknown;
  message?: unknown;
}

function printIssues(body: Record<string, unknown>): void {
  const issues = Array.isArray(body.issues) ? (body.issues as Issue[]) : [];
  if (issues.length === 0) {
    console.error('  (no issues[] array in the 422 response — raw body below)');
    console.error('  ' + JSON.stringify(body));
    return;
  }
  for (const issue of issues) {
    const path = Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path ?? '(root)');
    console.error(`  • ${path}: ${String(issue.message ?? 'invalid')}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Step 1 — registration handshake.
// ---------------------------------------------------------------------------

interface Registration {
  sourceId: string;
  apiKey: string;
}

async function register(opts: CliOptions): Promise<Registration> {
  const endpoint = `${opts.url}/api/v1/sources/register`;
  console.log(`→ Registering "${AGENT_NAME}" at ${endpoint}`);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Registration-Token': opts.token,
      },
      body: JSON.stringify({ name: AGENT_NAME, agent_version: AGENT_VERSION }),
    });
  } catch (err) {
    console.error(`\n✖ Could not reach ${endpoint}.`);
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    console.error('  Is the API running and is --url correct?');
    process.exit(1);
  }

  const body = asRecord(await readJson(res));

  if (!res.ok) {
    const hint: Record<number, string> = {
      400: 'Missing/invalid registration token header or body.',
      401: 'Unknown registration token — copy a fresh one from "Add source".',
      409: 'Registration token already used — each token is one-time. Issue a new one.',
      410: 'Registration token expired (tokens last 24h) — issue a new one.',
    };
    console.error(`\n✖ Registration failed (HTTP ${res.status}).`);
    console.error(`  ${hint[res.status] ?? String(body.error ?? 'Unexpected error.')}`);
    process.exit(1);
  }

  const sourceId = typeof body.source_id === 'string' ? body.source_id : '';
  const apiKey = typeof body.api_key === 'string' ? body.api_key : '';
  if (!sourceId || !apiKey) {
    console.error('\n✖ Registration response missing source_id/api_key.');
    console.error('  ' + JSON.stringify(body));
    process.exit(1);
  }

  console.log(`✓ Registered. source_id=${sourceId}, api_key=${apiKey.slice(0, 8)}…\n`);
  return { sourceId, apiKey };
}

// ---------------------------------------------------------------------------
// Step 2 — publish a report. Returns true to keep looping, false to stop.
// ---------------------------------------------------------------------------

function buildPayload(reg: Registration, input: ReportInput): Record<string, unknown> {
  return {
    version: SCHEMA_VERSION,
    source: { id: reg.sourceId },
    category: input.category,
    stream: input.stream,
    report: input.report,
    blocks: input.blocks,
  };
}

async function publish(opts: CliOptions, reg: Registration, input: ReportInput): Promise<boolean> {
  const endpoint = `${opts.url}/api/v1/reports`;
  const label = `${input.report.title} → ${input.category.slug}/${input.stream.slug}`;

  // Retry loop exists solely for 429 back-off; every other status returns.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${reg.apiKey}`,
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify(buildPayload(reg, input)),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`✖ Network error pushing "${input.report.title}": ${reason}`);
      return true; // transient — keep the loop alive.
    }

    if (res.status === 201 || res.status === 200) {
      const tag = res.status === 200 ? 'dup' : '201';
      console.log(`✓ pushed ${label} (HTTP ${tag})`);
      return true;
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * (attempt + 1);
      console.warn(`… rate limited (429); backing off ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    const body = asRecord(await readJson(res));

    if (res.status === 422) {
      // A 422 means the demo emitted an invalid block — that's a bug, not a
      // runtime condition. Surface the issues[] and exit non-zero.
      console.error(`\n✖ Validation failed (HTTP 422) for "${input.report.title}":`);
      printIssues(body);
      console.error('\nThis is a bug in the demo templates — fix the offending block.\n');
      process.exit(1);
    }

    if (res.status === 401 || res.status === 403 || res.status === 409) {
      const hint: Record<number, string> = {
        401: 'API key rejected — the source may have been revoked or rotated.',
        403: "Report is out of the source's scope (category/stream not permitted).",
        409: 'Unknown category/stream slug and autocreate is disabled for this source.',
      };
      console.error(`\n✖ ${hint[res.status]} (HTTP ${res.status}). Stopping.`);
      return false;
    }

    console.error(`\n✖ Unexpected HTTP ${res.status} pushing "${input.report.title}". Stopping.`);
    console.error('  ' + JSON.stringify(body));
    return false;
  }

  console.error('✖ Still rate limited after several back-offs. Stopping.');
  return false;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const reg = await register(opts);

  if (opts.once) {
    const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)]!;
    const ok = await publish(opts, reg, template.build(new Date()));
    process.exit(ok ? 0 : 1);
  }

  console.log(
    `Pushing a report every ${Math.round(opts.interval / 1000)}s. Press Ctrl-C to stop.\n`,
  );
  let i = 0;
  // Rotate through the templates so all 8 block types are exercised quickly.
  for (;;) {
    const template = TEMPLATES[i % TEMPLATES.length]!;
    i += 1;
    const keepGoing = await publish(opts, reg, template.build(new Date()));
    if (!keepGoing) process.exit(1);
    await sleep(opts.interval);
  }
}

main().catch((err: unknown) => {
  console.error(`\n✖ Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
