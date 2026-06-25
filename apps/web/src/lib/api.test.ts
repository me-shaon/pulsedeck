import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  archiveReports,
  deleteReports,
  getAuthConfig,
  listReports,
  removeMember,
  setup,
  unarchiveReports,
} from './api';

/**
 * Unit tests for the typed `fetch` wrapper. We stub the global `fetch` and
 * assert on (a) how the request is built (URL, method, body, credentials) and
 * (b) how responses are mapped — JSON parse, 204 → undefined, and the
 * non-2xx → {@link ApiError} translation including Zod issue flattening.
 */

const fetchMock = vi.fn();

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request building', () => {
  it('GETs the versioned path with credentials and no body/content-type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ githubEnabled: false, setupRequired: true }));

    const out = await getAuthConfig();

    expect(out).toEqual({ githubEnabled: false, setupRequired: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/auth/config');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    // No request body → no content-type header forced.
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('POSTs JSON with content-type and serialized body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ user: { id: 'u1' }, workspace: { id: 'ws_1' } }, { status: 201 }),
    );

    await setup({ name: 'Ada', email: 'a@b.com', password: 'supersecret1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/setup');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({
      name: 'Ada',
      email: 'a@b.com',
      password: 'supersecret1',
    });
  });

  it('serializes query params: arrays join with commas; undefined/empty dropped', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reports: [], nextCursor: null }));

    await listReports(
      'ws_1',
      { tags: ['db', 'auth'], severity: ['warning', 'critical'], q: '', category: 'sys' },
      undefined,
      25,
    );

    const [url] = fetchMock.mock.calls[0];
    const qs = new URL(url, 'http://x').searchParams;
    // Array filters are comma-joined into a single param.
    expect(qs.get('tags')).toBe('db,auth');
    expect(qs.get('severity')).toBe('warning,critical');
    expect(qs.get('category')).toBe('sys');
    expect(qs.get('limit')).toBe('25');
    // Empty string `q` and undefined cursor must be omitted entirely.
    expect(qs.has('q')).toBe(false);
    expect(qs.has('cursor')).toBe(false);
  });

  it('omits the default "active" archive scope but sends "archived"/"all"', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ reports: [], nextCursor: null })),
    );

    await listReports('ws_1', { archived: 'active' });
    expect(new URL(fetchMock.mock.calls[0][0], 'http://x').searchParams.has('archived')).toBe(
      false,
    );

    await listReports('ws_1', { archived: 'archived' });
    expect(new URL(fetchMock.mock.calls[1][0], 'http://x').searchParams.get('archived')).toBe(
      'archived',
    );

    await listReports('ws_1', { archived: 'all' });
    expect(new URL(fetchMock.mock.calls[2][0], 'http://x').searchParams.get('archived')).toBe(
      'all',
    );
  });

  it.each([
    ['archive', archiveReports, '/api/v1/workspaces/ws_1/reports/bulk/archive'],
    ['unarchive', unarchiveReports, '/api/v1/workspaces/ws_1/reports/bulk/unarchive'],
    ['delete', deleteReports, '/api/v1/workspaces/ws_1/reports/bulk/delete'],
  ])('%s POSTs the ids array to the bulk endpoint', async (_label, fn, expectedPath) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ affected: 2 }));

    const out = await fn('ws_1', ['r1', 'r2']);

    expect(out).toEqual({ affected: 2 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(expectedPath);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ ids: ['r1', 'r2'] });
  });
});

describe('response mapping', () => {
  it('returns undefined for 204 No Content', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(removeMember('ws_1', 'u1')).resolves.toBeUndefined();
  });

  it('throws ApiError carrying status + error code for non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'Setup has already been completed' }, { status: 409 }),
    );

    const err = await setup({ name: 'x', email: 'x@y.z', password: 'supersecret1' }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('Setup has already been completed');
    expect(err.code).toBe('Setup has already been completed');
  });

  it('flattens Zod-style issues into the message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'Invalid request',
          issues: [{ message: 'name is required' }, { message: 'email is invalid' }],
        },
        { status: 400 },
      ),
    );

    const err = await setup({ name: '', email: 'bad', password: 'short' }).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.message).toBe('name is required; email is invalid');
  });

  it('prefers an explicit message field over error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: 'Human readable', error: 'machine_code' }, { status: 422 }),
    );
    const err = await getAuthConfig().catch((e) => e);
    expect(err.message).toBe('Human readable');
    expect(err.code).toBe('machine_code');
  });

  it('maps a fetch/network rejection to ApiError(0, network)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = await getAuthConfig().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('network');
  });
});
