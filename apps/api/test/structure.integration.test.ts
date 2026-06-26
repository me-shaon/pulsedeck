import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth, type Auth, type AuthEnv } from '../src/auth/auth.js';
import { and, eq } from 'drizzle-orm';
import { categories, createDrizzle, id, streams, type Db } from '../src/db/index.js';
import { AGENT_UPDATES_CATEGORY_SLUG } from '../src/services/sources.js';
import type { Sql } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { buildServer } from '../src/server.js';
import {
  createCategory as createCategorySvc,
  createStream as createStreamSvc,
  renameCategory,
  deleteCategory,
  reorderCategories,
} from '../src/services/structure.js';

/**
 * Manual category/stream management + agent-instructions, against a real
 * Postgres. Gated on DATABASE_URL (skipped otherwise). Same harness as the
 * sources integration test: postgres-js (`max: 5`), migrate, truncate, build
 * via `buildServer`, then bootstrap an admin + editor + viewer.
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

describeIfDb('structure: manual category/stream management (integration)', () => {
  let sql: Sql;
  let db: Db;
  let auth: Auth;
  let app: FastifyInstance;

  const admin = { name: 'Ada', email: `admin-${id('usr')}@example.com`, password: 'supersecret1' };
  const editor = {
    name: 'Edie',
    email: `editor-${id('usr')}@example.com`,
    password: 'supersecret2',
  };
  const viewer = {
    name: 'Val',
    email: `viewer-${id('usr')}@example.com`,
    password: 'supersecret3',
  };
  let workspaceId: string;
  let adminCookie: string;
  let editorCookie: string;
  let viewerCookie: string;

  async function inviteAndAccept(role: 'editor' | 'viewer', cookie: string) {
    const invite = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invites`,
      headers: { cookie: adminCookie },
      payload: { role },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/invites/accept',
      headers: { cookie },
      payload: { token: invite.json().invite.token },
    });
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 5, onnotice: () => {} });
    db = createDrizzle(sql);
    await runMigrations(sql);
    await sql`TRUNCATE users, billing_accounts, workspaces, workspace_members, invites, sources,
      source_registration_tokens, source_categories, source_streams, categories,
      streams, reports, account, session, verification RESTART IDENTITY CASCADE`;

    auth = createAuth(db, AUTH_ENV);
    app = buildServer({ sql, env: AUTH_ENV, auth });
    await app.ready();

    const setup = await app.inject({ method: 'POST', url: '/api/v1/setup', payload: admin });
    workspaceId = setup.json().workspace.id;
    adminCookie = cookieFromInject(setup.headers['set-cookie']);

    const editorSignup = await auth.api.signUpEmail({
      body: { name: editor.name, email: editor.email, password: editor.password },
      returnHeaders: true,
    });
    editorCookie = cookieFromHeaders(editorSignup.headers);
    await inviteAndAccept('editor', editorCookie);

    const viewerSignup = await auth.api.signUpEmail({
      body: { name: viewer.name, email: viewer.email, password: viewer.password },
      returnHeaders: true,
    });
    viewerCookie = cookieFromHeaders(viewerSignup.headers);
    await inviteAndAccept('viewer', viewerCookie);
  });

  afterAll(async () => {
    await app?.close();
    await sql?.end({ timeout: 5 });
  });

  // --- Service layer --------------------------------------------------------

  it('service: createCategory derives slug, sets labelSource=user and position max+1', async () => {
    const a = await createCategorySvc(db, { workspaceId, name: 'Infra' });
    if ('error' in a) throw new Error(a.error);
    expect(a.category.slug).toBe('infra');
    expect(a.category.labelSource).toBe('user');
    const b = await createCategorySvc(db, { workspaceId, name: 'Ops' });
    if ('error' in b) throw new Error(b.error);
    expect(b.category.position).toBe(a.category.position + 1);
  });

  it('service: createCategory returns slug_exists on duplicate slug', async () => {
    await createCategorySvc(db, { workspaceId, name: 'Dup', slug: 'dup' });
    const again = await createCategorySvc(db, { workspaceId, name: 'Dup 2', slug: 'dup' });
    expect('error' in again && again.error).toBe('slug_exists');
  });

  it('service: createStream under a category, slug derived', async () => {
    const c = await createCategorySvc(db, { workspaceId, name: 'CI' });
    if ('error' in c) throw new Error(c.error);
    const s = await createStreamSvc(db, {
      workspaceId,
      categoryId: c.category.id,
      name: 'Build Status',
    });
    if ('error' in s) throw new Error(s.error);
    expect(s.stream.slug).toBe('build-status');
    expect(s.stream.labelSource).toBe('user');
  });

  it('service: createStream rejects a category from another workspace', async () => {
    const res = await createStreamSvc(db, {
      workspaceId,
      categoryId: 'cat_does_not_exist',
      name: 'X',
    });
    expect('error' in res && res.error).toBe('not_found');
  });

  it('service: renameCategory sets name + labelSource=user, keeps slug', async () => {
    const c = await createCategorySvc(db, { workspaceId, name: 'Old', slug: 'keepme' });
    if ('error' in c) throw new Error(c.error);
    const r = await renameCategory(db, workspaceId, c.category.id, 'New Name');
    if ('error' in r) throw new Error(r.error);
    expect(r.category.name).toBe('New Name');
    expect(r.category.slug).toBe('keepme');
    expect(r.category.labelSource).toBe('user');
  });

  it('service: deleteCategory cascades its streams', async () => {
    const c = await createCategorySvc(db, { workspaceId, name: 'Doomed' });
    if ('error' in c) throw new Error(c.error);
    await createStreamSvc(db, { workspaceId, categoryId: c.category.id, name: 'S1' });
    const del = await deleteCategory(db, workspaceId, c.category.id);
    expect(del).toEqual({ ok: true });
    const rows = await db.select().from(streams).where(eq(streams.categoryId, c.category.id));
    expect(rows.length).toBe(0);
  });

  it('service: reorderCategories sets position by index, rejects foreign ids', async () => {
    const a = await createCategorySvc(db, { workspaceId, name: 'AA' });
    const b = await createCategorySvc(db, { workspaceId, name: 'BB' });
    if ('error' in a || 'error' in b) throw new Error('setup');
    const r = await reorderCategories(db, workspaceId, [b.category.id, a.category.id]);
    expect(r).toEqual({ ok: true });
    const [bRow] = await db.select().from(categories).where(eq(categories.id, b.category.id));
    const [aRow] = await db.select().from(categories).where(eq(categories.id, a.category.id));
    expect(bRow.position).toBe(0);
    expect(aRow.position).toBe(1);

    const bad = await reorderCategories(db, workspaceId, ['cat_not_here']);
    expect('error' in bad && bad.error).toBe('bad_order');
  });

  // --- Route layer + RBAC ---------------------------------------------------

  it('route: editor can create a category (201, labelSource=user)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/categories`,
      headers: { cookie: editorCookie },
      payload: { name: 'Editor Cat' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().category.labelSource).toBe('user');
  });

  it('route: viewer cannot create a category (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/categories`,
      headers: { cookie: viewerCookie },
      payload: { name: 'Nope' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('route: duplicate slug → 409', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/categories`,
      headers: { cookie: adminCookie },
      payload: { name: 'X', slug: 'dupe' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/categories`,
      headers: { cookie: adminCookie },
      payload: { name: 'Y', slug: 'dupe' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('route: create stream, rename it, delete it', async () => {
    const cat = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/categories`,
        headers: { cookie: adminCookie },
        payload: { name: 'Cat7' },
      })
    ).json().category;
    const stm = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/categories/${cat.id}/streams`,
        headers: { cookie: adminCookie },
        payload: { name: 'S7' },
      })
    ).json().stream;
    const ren = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}/streams/${stm.id}`,
      headers: { cookie: adminCookie },
      payload: { name: 'Renamed' },
    });
    expect(ren.json().stream.name).toBe('Renamed');
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${workspaceId}/streams/${stm.id}`,
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(204);
  });

  it('route: category + stream reorder endpoints', async () => {
    const cat = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/categories`,
        headers: { cookie: adminCookie },
        payload: { name: 'Reorder Cat' },
      })
    ).json().category;
    const s1 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/categories/${cat.id}/streams`,
        headers: { cookie: adminCookie },
        payload: { name: 'R1' },
      })
    ).json().stream;
    const s2 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/categories/${cat.id}/streams`,
        headers: { cookie: adminCookie },
        payload: { name: 'R2' },
      })
    ).json().stream;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}/categories/${cat.id}/streams/reorder`,
      headers: { cookie: adminCookie },
      payload: { ids: [s2.id, s1.id] },
    });
    expect(res.statusCode).toBe(200);
    const [s2Row] = await db.select().from(streams).where(eq(streams.id, s2.id));
    expect(s2Row.position).toBe(0);
  });

  // --- Agent instructions (sources:manage) ----------------------------------

  it('route: stream agent-instructions pins both slugs (admin); editor denied', async () => {
    const cat = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/categories`,
        headers: { cookie: adminCookie },
        payload: { name: 'InfraI', slug: 'infra-i' },
      })
    ).json().category;
    const stm = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/categories/${cat.id}/streams`,
        headers: { cookie: adminCookie },
        payload: { name: 'Health', slug: 'system-health' },
      })
    ).json().stream;
    const src = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/sources`,
        headers: { cookie: adminCookie },
        payload: { name: 'Bot' },
      })
    ).json().source;

    const ok = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/streams/${stm.id}/agent-instructions?sourceId=${src.id}`,
      headers: { cookie: adminCookie },
    });
    expect(ok.statusCode).toBe(200);
    // Brief task brief: findings routing only, no onboarding protocol/token.
    expect(ok.json().setupPrompt).toContain('category "infra-i", stream "system-health"');
    expect(ok.json().registrationToken).toBeUndefined();
    expect(ok.json().setupPrompt).not.toContain('STEP 1');

    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/streams/${stm.id}/agent-instructions?sourceId=${src.id}`,
      headers: { cookie: editorCookie },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('route: category agent-instructions pins the category slug', async () => {
    const cat = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/categories`,
        headers: { cookie: adminCookie },
        payload: { name: 'CatLevel', slug: 'cat-level' },
      })
    ).json().category;
    const src = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/sources`,
        headers: { cookie: adminCookie },
        payload: { name: 'Bot2' },
      })
    ).json().source;
    const ok = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/categories/${cat.id}/agent-instructions?sourceId=${src.id}`,
      headers: { cookie: adminCookie },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().setupPrompt).toContain('category "cat-level"');
    expect(ok.json().setupPrompt).toContain('choose or create a stream');
  });

  it('route: task text is woven into the generated prompt', async () => {
    const cat = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/categories`,
        headers: { cookie: adminCookie },
        payload: { name: 'Task Cat', slug: 'task-cat' },
      })
    ).json().category;
    const src = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/sources`,
        headers: { cookie: adminCookie },
        payload: { name: 'Task Bot' },
      })
    ).json().source;
    const task = encodeURIComponent('Ping these URLs every 5m and report up/down');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/categories/${cat.id}/agent-instructions?sourceId=${src.id}&task=${task}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().setupPrompt).toContain('YOUR TASK');
    expect(res.json().setupPrompt).toContain('Ping these URLs every 5m and report up/down');
  });

  it('route: agent-instructions for a revoked source → 409', async () => {
    const cat = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/categories`,
        headers: { cookie: adminCookie },
        payload: { name: 'Revoke Cat', slug: 'revoke-cat' },
      })
    ).json().category;
    const src = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/sources`,
        headers: { cookie: adminCookie },
        payload: { name: 'Doomed Bot' },
      })
    ).json().source;
    await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/sources/${src.id}/revoke`,
      headers: { cookie: adminCookie },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/categories/${cat.id}/agent-instructions?sourceId=${src.id}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(409);
  });

  it('route: the system agent-updates category cannot be renamed or deleted', async () => {
    // Creating a source provisions the workspace's agent-updates lane.
    await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/sources`,
      headers: { cookie: adminCookie },
      payload: { name: 'Lock Bot' },
    });
    const [sysCat] = await db
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.workspaceId, workspaceId),
          eq(categories.slug, AGENT_UPDATES_CATEGORY_SLUG),
        ),
      );

    const ren = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}/categories/${sysCat.id}`,
      headers: { cookie: adminCookie },
      payload: { name: 'Hijacked' },
    });
    expect(ren.statusCode).toBe(403);
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${workspaceId}/categories/${sysCat.id}`,
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(403);
  });
});
