import type { Block } from '@pulsedeck/schema';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth, type Auth, type AuthEnv } from '../src/auth/auth.js';
import {
  categories,
  createDrizzle,
  id,
  reports,
  sources,
  streams,
  workspaceMembers,
  workspaces,
  type Db,
} from '../src/db/index.js';
import type { Sql } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { buildServer } from '../src/server.js';

/**
 * Phase 6 read APIs end-to-end against a real Postgres (gated on DATABASE_URL;
 * skipped otherwise). Mirrors the Phase 4/5 harness: postgres-js max 5, migrate,
 * truncate, buildServer, app.inject. Reports are seeded directly (with a real
 * search_vector) so received_at ordering and full-text matches are deterministic.
 *
 * Covers: list (summary shape, newest-first, blockCount), keyset pagination +
 * stability + malformed cursor, every filter + a combination, full-text search +
 * compose, stream-feed scoping + foreign stream 404, detail (full blocks +
 * prev/next boundaries) + foreign report 404, the category→stream tree, and the
 * RBAC reads (viewer allowed, non-member 404, unauth 401) + cross-workspace
 * isolation.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const AUTH_ENV: AuthEnv = {
  AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
  BETTER_AUTH_URL: 'http://localhost:3001',
};

function cookieFromHeaders(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

function cookieFromInject(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(';')[0]).join('; ');
}

function mdBlocks(n: number): Block[] {
  return Array.from({ length: n }, (_v, i) => ({
    id: `b${i}`,
    type: 'markdown' as const,
    content: `c${i}`,
  }));
}

describeIfDb('reports read APIs (integration)', () => {
  let sqlClient: Sql;
  let db: Db;
  let auth: Auth;
  let app: FastifyInstance;

  const admin = { name: 'Ada', email: `admin-${id('usr')}@example.com`, password: 'supersecret1' };
  let workspaceId: string;
  let adminCookie: string;
  let viewerCookie: string;
  let strangerCookie: string;

  let sourceId: string;
  // Streams in workspace 1.
  let stDeploys: string;
  let stInfra: string;
  let stSeo: string;
  let stEmpty: string;
  let stPage: string;
  // Key reports in stDeploys (oldest → newest: R1, R2, R3).
  let r1: string;
  let r2: string;
  let r3: string;
  // Foreign-workspace report + stream (must never leak into workspace 1).
  let foreignReportId: string;
  let foreignStreamId: string;

  /** Insert a report directly with a populated search_vector. */
  async function seedReport(opts: {
    streamId: string;
    title: string;
    summary?: string | null;
    severity?: 'info' | 'warning' | 'critical' | null;
    tags?: string[];
    receivedAt: Date;
    blocks?: number;
    source?: string;
  }): Promise<string> {
    const rid = id('rpt');
    const tags = opts.tags ?? [];
    const summary = opts.summary ?? null;
    await db.insert(reports).values({
      id: rid,
      streamId: opts.streamId,
      sourceId: opts.source ?? sourceId,
      idempotencyKey: rid,
      title: opts.title,
      summary,
      severity: opts.severity ?? null,
      occurredAt: opts.receivedAt,
      receivedAt: opts.receivedAt,
      tags,
      blocks: mdBlocks(opts.blocks ?? 1),
      searchVector: sql`to_tsvector('english', ${opts.title} || ' ' || ${summary ?? ''} || ' ' || ${tags.join(' ')})`,
    });
    return rid;
  }

  function get(url: string, cookie: string = adminCookie) {
    return app.inject({ method: 'GET', url, headers: { cookie } });
  }

  beforeAll(async () => {
    sqlClient = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sqlClient);
    await runMigrations(sqlClient);
    await sqlClient`TRUNCATE users, workspaces, workspace_members, invites, sources,
      source_registration_tokens, source_categories, source_streams, categories,
      streams, reports, report_metrics, account, session, verification
      RESTART IDENTITY CASCADE`;

    auth = createAuth(db, AUTH_ENV);
    app = buildServer({ sql: sqlClient, env: AUTH_ENV, auth });
    await app.ready();

    // Admin (Owner) + workspace via the setup flow.
    const setup = await app.inject({ method: 'POST', url: '/api/v1/setup', payload: admin });
    workspaceId = setup.json().workspace.id;
    adminCookie = cookieFromInject(setup.headers['set-cookie']);

    // A Viewer member + a non-member stranger.
    const viewer = await auth.api.signUpEmail({
      body: { name: 'Vic', email: `viewer-${id('usr')}@example.com`, password: 'supersecret2' },
      returnHeaders: true,
    });
    viewerCookie = cookieFromHeaders(viewer.headers);
    await db
      .insert(workspaceMembers)
      .values({ workspaceId, userId: viewer.response.user.id, role: 'viewer' });

    const stranger = await auth.api.signUpEmail({
      body: { name: 'Stra', email: `stranger-${id('usr')}@example.com`, password: 'supersecret3' },
      returnHeaders: true,
    });
    strangerCookie = cookieFromHeaders(stranger.headers);

    // Source for the seeded reports.
    sourceId = id('src');
    await db.insert(sources).values({ id: sourceId, workspaceId, name: 'Seed Agent' });

    // Categories (engineering pos 0, marketing pos 1).
    const cEng = id('cat');
    const cMkt = id('cat');
    await db.insert(categories).values([
      { id: cEng, workspaceId, name: 'Engineering', slug: 'engineering', position: 0 },
      { id: cMkt, workspaceId, name: 'Marketing', slug: 'marketing', position: 1 },
    ]);

    // Streams.
    stDeploys = id('stm');
    stInfra = id('stm');
    stPage = id('stm');
    stSeo = id('stm');
    stEmpty = id('stm');
    await db.insert(streams).values([
      { id: stDeploys, categoryId: cEng, name: 'Deploys', slug: 'deploys', position: 0 },
      { id: stInfra, categoryId: cEng, name: 'Infra', slug: 'infra', position: 1 },
      { id: stPage, categoryId: cEng, name: 'Page', slug: 'page', position: 2 },
      { id: stSeo, categoryId: cMkt, name: 'Seo', slug: 'seo', position: 0 },
      { id: stEmpty, categoryId: cMkt, name: 'Empty', slug: 'empty', position: 1 },
    ]);

    // Main reports in stDeploys (oldest → newest).
    r1 = await seedReport({
      streamId: stDeploys,
      title: 'Alpha deployment summary',
      summary: 'first production deploy succeeded',
      severity: 'info',
      tags: ['prod', 'deploy'],
      receivedAt: new Date('2026-01-01T00:00:00Z'),
      blocks: 1,
    });
    r2 = await seedReport({
      streamId: stDeploys,
      title: 'Beta release',
      summary: 'staging rollout',
      severity: 'warning',
      tags: ['staging'],
      receivedAt: new Date('2026-01-02T00:00:00Z'),
      blocks: 2,
    });
    r3 = await seedReport({
      streamId: stDeploys,
      title: 'Gamma incident postmortem',
      summary: 'database latency spike resolved',
      severity: 'critical',
      tags: ['prod', 'db'],
      receivedAt: new Date('2026-01-03T00:00:00Z'),
      blocks: 3,
    });
    await seedReport({
      streamId: stInfra,
      title: 'Infra cost report',
      summary: 'aws spend up',
      severity: 'info',
      tags: ['cost'],
      receivedAt: new Date('2026-01-04T00:00:00Z'),
      blocks: 1,
    });
    await seedReport({
      streamId: stSeo,
      title: 'SEO audit',
      summary: 'keyword rankings improved',
      severity: 'info',
      tags: ['seo'],
      receivedAt: new Date('2026-01-05T00:00:00Z'),
      blocks: 2,
    });

    // Five reports in stPage for keyset pagination (P1 oldest → P5 newest).
    for (let i = 1; i <= 5; i++) {
      await seedReport({
        streamId: stPage,
        title: `Page report ${i}`,
        receivedAt: new Date(`2026-03-0${i}T00:00:00Z`),
        blocks: 1,
      });
    }

    // A second workspace with its own report + stream — cross-workspace isolation.
    const ws2 = id('ws');
    await db.insert(workspaces).values({ id: ws2, name: 'Other', slug: `other-${id('ws')}` });
    const cOther = id('cat');
    await db.insert(categories).values({ id: cOther, workspaceId: ws2, name: 'X', slug: 'x' });
    foreignStreamId = id('stm');
    await db
      .insert(streams)
      .values({ id: foreignStreamId, categoryId: cOther, name: 'Y', slug: 'y' });
    const srcOther = id('src');
    await db.insert(sources).values({ id: srcOther, workspaceId: ws2, name: 'Other Agent' });
    foreignReportId = await seedReport({
      streamId: foreignStreamId,
      title: 'Foreign report postmortem',
      summary: 'should never leak',
      receivedAt: new Date('2026-02-01T00:00:00Z'),
      source: srcOther,
      blocks: 1,
    });
  });

  afterAll(async () => {
    await app?.close();
    await sqlClient?.end({ timeout: 5 });
  });

  // --- List: shape + ordering -----------------------------------------------

  it('stream feed returns newest-first SUMMARY items (no blocks), correct blockCount', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/streams/${stDeploys}/reports`);
    expect(res.statusCode).toBe(200);
    const { reports: list, nextCursor } = res.json();
    expect(list.map((r: { id: string }) => r.id)).toEqual([r3, r2, r1]); // newest → oldest
    expect(nextCursor).toBeNull();

    const top = list[0];
    expect(top).not.toHaveProperty('blocks'); // summary, never the JSONB
    expect(top.blockCount).toBe(3);
    expect(list[2].blockCount).toBe(1);
    expect(top).toMatchObject({
      id: r3,
      title: 'Gamma incident postmortem',
      severity: 'critical',
      tags: ['prod', 'db'],
      source: { id: sourceId, name: 'Seed Agent' },
      stream: { id: stDeploys, slug: 'deploys', name: 'Deploys' },
      category: { slug: 'engineering', name: 'Engineering' },
    });
    expect(typeof top.receivedAt).toBe('string');
  });

  it('workspace-wide All Reports lists every workspace report newest-first', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/reports?limit=100`);
    expect(res.statusCode).toBe(200);
    const ids = res.json().reports.map((r: { id: string }) => r.id);
    // 5 main + 5 page = 10, and the foreign report must be absent.
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain(foreignReportId);
    // received_at desc holds: the stPage reports (March) precede the January ones.
    expect(ids.slice(0, 5).every((x: string) => x.startsWith('rpt_'))).toBe(true);
  });

  // --- Keyset pagination -----------------------------------------------------

  it('keyset pagination covers all rows with no overlap/gap and is stable under inserts', async () => {
    const url = `/api/v1/workspaces/${workspaceId}/streams/${stPage}/reports?limit=2`;
    const page1 = await get(url);
    expect(page1.statusCode).toBe(200);
    const ids1: string[] = page1.json().reports.map((r: { id: string }) => r.id);
    const c1: string | null = page1.json().nextCursor;
    expect(ids1).toHaveLength(2);
    expect(c1).toBeTruthy();

    // Insert a brand-new NEWEST report between page fetches — keyset must not let
    // it duplicate or shift the rows already seen on page 1.
    const intruder = await seedReport({
      streamId: stPage,
      title: 'Page report intruder',
      receivedAt: new Date('2026-03-09T00:00:00Z'),
      blocks: 1,
    });

    const page2 = await get(`${url}&cursor=${encodeURIComponent(c1!)}`);
    const ids2: string[] = page2.json().reports.map((r: { id: string }) => r.id);
    const c2: string | null = page2.json().nextCursor;
    expect(ids2).toHaveLength(2);

    const page3 = await get(`${url}&cursor=${encodeURIComponent(c2!)}`);
    const ids3: string[] = page3.json().reports.map((r: { id: string }) => r.id);
    expect(ids3).toHaveLength(1);
    expect(page3.json().nextCursor).toBeNull(); // last page

    const all = [...ids1, ...ids2, ...ids3];
    expect(new Set(all).size).toBe(5); // no overlap
    expect(all).not.toContain(intruder); // newer-than-cursor row never appears
  });

  it('malformed cursor → 400', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/reports?cursor=not-a-valid-cursor`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_query');
  });

  // --- Filters ---------------------------------------------------------------

  it('severity filter returns only matching reports', async () => {
    const res = await get(
      `/api/v1/workspaces/${workspaceId}/streams/${stDeploys}/reports?severity=critical`,
    );
    expect(res.json().reports.map((r: { id: string }) => r.id)).toEqual([r3]);
  });

  it('tag filter uses ANY (array overlap) semantics', async () => {
    const res = await get(
      `/api/v1/workspaces/${workspaceId}/streams/${stDeploys}/reports?tags=prod`,
    );
    expect(
      res
        .json()
        .reports.map((r: { id: string }) => r.id)
        .sort(),
    ).toEqual([r1, r3].sort());
  });

  it('category filter (by slug) scopes to that category', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/reports?category=marketing`);
    const titles = res.json().reports.map((r: { title: string }) => r.title);
    expect(titles).toEqual(['SEO audit']);
  });

  it('stream filter (by slug) on the workspace-wide list scopes to that stream', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/reports?stream=infra`);
    expect(res.json().reports.map((r: { title: string }) => r.title)).toEqual([
      'Infra cost report',
    ]);
  });

  it('source filter returns that source only', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/reports?source=${sourceId}&limit=100`);
    const ids = res.json().reports.map((r: { id: string }) => r.id);
    expect(ids).toContain(r1);
    expect(ids).not.toContain(foreignReportId);
  });

  it('combined severity + tag + date range returns the exact subset', async () => {
    const res = await get(
      `/api/v1/workspaces/${workspaceId}/streams/${stDeploys}/reports` +
        `?severity=critical&tags=prod&from=2026-01-03T00:00:00Z&to=2026-01-03T23:59:59Z`,
    );
    expect(res.json().reports.map((r: { id: string }) => r.id)).toEqual([r3]);
  });

  it('date range alone selects the in-range rows', async () => {
    const res = await get(
      `/api/v1/workspaces/${workspaceId}/streams/${stDeploys}/reports` +
        `?from=2026-01-02T00:00:00Z&to=2026-01-03T23:59:59Z`,
    );
    expect(res.json().reports.map((r: { id: string }) => r.id)).toEqual([r3, r2]);
  });

  it('invalid date → 400', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/reports?from=not-a-date`);
    expect(res.statusCode).toBe(400);
  });

  // --- Full-text search ------------------------------------------------------

  it('search q matches a summary/title word', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/reports?q=postmortem`);
    // Only the Gamma report carries "postmortem" in this workspace.
    expect(res.json().reports.map((r: { id: string }) => r.id)).toEqual([r3]);
  });

  it('search q with no match returns none', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/reports?q=zzzznotawordhere`);
    expect(res.json().reports).toHaveLength(0);
  });

  it('search composes with a filter', async () => {
    const res = await get(
      `/api/v1/workspaces/${workspaceId}/streams/${stDeploys}/reports?q=deploy&severity=info`,
    );
    expect(res.json().reports.map((r: { id: string }) => r.id)).toEqual([r1]);
  });

  // --- Stream scoping --------------------------------------------------------

  it('a foreign stream → 404', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/streams/${foreignStreamId}/reports`);
    expect(res.statusCode).toBe(404);
  });

  // --- Detail ----------------------------------------------------------------

  it('detail returns full blocks + metadata; prev/next correct at boundaries', async () => {
    const newest = await get(`/api/v1/workspaces/${workspaceId}/reports/${r3}`);
    expect(newest.statusCode).toBe(200);
    const d3 = newest.json();
    expect(d3.report.blocks).toHaveLength(3); // full blocks present
    expect(d3.report).toMatchObject({
      id: r3,
      severity: 'critical',
      stream: { id: stDeploys, slug: 'deploys' },
      category: { slug: 'engineering' },
      source: { id: sourceId },
    });
    expect(typeof d3.report.createdAt).toBe('string');
    expect(d3.prevReportId).toBeNull(); // newest → no newer neighbour
    expect(d3.nextReportId).toBe(r2);

    const oldest = await get(`/api/v1/workspaces/${workspaceId}/reports/${r1}`);
    const d1 = oldest.json();
    expect(d1.prevReportId).toBe(r2);
    expect(d1.nextReportId).toBeNull(); // oldest → no older neighbour

    const middle = await get(`/api/v1/workspaces/${workspaceId}/reports/${r2}`);
    expect(middle.json()).toMatchObject({ prevReportId: r3, nextReportId: r1 });
  });

  it('a foreign report → 404 (not addressable from this workspace)', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/reports/${foreignReportId}`);
    expect(res.statusCode).toBe(404);
  });

  // --- Tree ------------------------------------------------------------------

  it('tree returns categories→streams ordered by position with per-stream counts', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/tree`);
    expect(res.statusCode).toBe(200);
    const cats = res.json().categories;
    expect(cats.map((c: { slug: string }) => c.slug)).toEqual(['engineering', 'marketing']);

    const eng = cats[0];
    expect(eng.streams.map((s: { slug: string }) => s.slug)).toEqual(['deploys', 'infra', 'page']);
    const deploys = eng.streams.find((s: { slug: string }) => s.slug === 'deploys');
    expect(deploys.reportCount).toBe(3);
    expect(typeof deploys.lastReportAt).toBe('string');

    const mkt = cats[1];
    const empty = mkt.streams.find((s: { slug: string }) => s.slug === 'empty');
    expect(empty.reportCount).toBe(0);
    expect(empty.lastReportAt).toBeNull();
  });

  // --- RBAC ------------------------------------------------------------------

  it('a Viewer can read (reports:view allows all roles)', async () => {
    const res = await get(`/api/v1/workspaces/${workspaceId}/reports`, viewerCookie);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().reports)).toBe(true);
  });

  it('a non-member → 404 (existence hidden); unauthenticated → 401', async () => {
    const stranger = await get(`/api/v1/workspaces/${workspaceId}/reports`, strangerCookie);
    expect(stranger.statusCode).toBe(404);

    const unauth = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/reports`,
    });
    expect(unauth.statusCode).toBe(401);
  });
});
