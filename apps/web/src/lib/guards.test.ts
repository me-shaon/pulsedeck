import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureAuthConfig, ensureSession, ensureWorkspaces, invalidateAuth } from './guards';
import { queryKeys } from './query-client';
import { fetchSessionUser } from './auth-client';

/**
 * Regression tests for the "stuck Creating account…" bug.
 *
 * Root cause: after POST /setup (and after sign-in) the success path runs
 * `invalidateAuth()` then `navigate('/')`. The route guards read auth state
 * through `ensureQueryData`, which serves cached values. A plain
 * `invalidateQueries` only MARKS the auth queries stale — with no mounted
 * observer on /setup or /login nothing refetches — so the guard re-read the
 * OLD `setupRequired: true` / `session: null` and bounced straight back to the
 * page the user was already on. The fix forces the refetch (`refetchType:
 * 'all'`) so the cache is truthful before navigation.
 *
 * These tests assert that contract directly: invalidateAuth must trigger a
 * refetch of the auth queries even when they have no active observers, and the
 * cache must hold the fresh value afterwards.
 */

// Stub the better-auth session fetch so we don't exercise its HTTP internals.
vi.mock('./auth-client', () => ({ fetchSessionUser: vi.fn() }));

const fetchMock = vi.fn();
const fetchSessionUserMock = vi.mocked(fetchSessionUser);

/** Mutable backend state the mocked transport reflects. */
let setupRequired = true;

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  setupRequired = true;
  fetchSessionUserMock.mockReset();
  fetchSessionUserMock.mockResolvedValue(null);

  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/auth/config')) {
      return new Response(JSON.stringify({ githubEnabled: false, setupRequired }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/workspaces')) {
      return new Response(JSON.stringify({ workspaces: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function authConfigCalls(): number {
  return fetchMock.mock.calls.filter(([u]) => String(u).includes('/auth/config')).length;
}

describe('invalidateAuth (regression: stale auth cache after setup/login)', () => {
  it('refetches authConfig so the guard sees setupRequired flip to false', async () => {
    const qc = makeClient();

    // /setup page load warms authConfig: zero users → setupRequired true.
    const before = await ensureAuthConfig(qc);
    expect(before.setupRequired).toBe(true);
    expect(authConfigCalls()).toBe(1);

    // Account created server-side: setup is now complete.
    setupRequired = false;

    await invalidateAuth(qc);

    // The fix: invalidation forced a refetch even with no active observer...
    expect(authConfigCalls()).toBe(2);
    // ...so the cache the navigate('/') guard reads is now truthful.
    expect(qc.getQueryData(queryKeys.authConfig)).toMatchObject({ setupRequired: false });
  });

  it('refetches the session so the guard sees the freshly signed-in user', async () => {
    const qc = makeClient();

    // Initial guard pass: no session yet.
    expect(await ensureSession(qc)).toBeNull();
    expect(fetchSessionUserMock).toHaveBeenCalledTimes(1);

    // Sign-in succeeded: the next session fetch resolves a user.
    const user = { id: 'u1', email: 'a@b.com', name: 'Ada', image: null };
    fetchSessionUserMock.mockResolvedValue(user);

    await invalidateAuth(qc);

    // Session was refetched (not served from the cached null)...
    expect(fetchSessionUserMock).toHaveBeenCalledTimes(2);
    // ...and the cache now holds the user the route guard will read.
    expect(qc.getQueryData(queryKeys.session)).toEqual(user);
  });

  it('invalidates workspaces so a new owner sees their first workspace', async () => {
    const qc = makeClient();
    const wsCalls = () =>
      fetchMock.mock.calls.filter(([u]) => String(u).includes('/workspaces')).length;

    await ensureWorkspaces(qc);
    expect(wsCalls()).toBe(1);

    await invalidateAuth(qc);

    // workspaces was refetched (not served stale) so the post-setup landing
    // resolution sees the workspace the owner just got.
    expect(wsCalls()).toBe(2);
  });
});

describe('ensure* guard helpers cache within their staleTime', () => {
  it('ensureAuthConfig serves a cached value on the second read (no refetch)', async () => {
    const qc = makeClient();
    await ensureAuthConfig(qc);
    await ensureAuthConfig(qc);
    // Two reads, one network call — guards stay cheap during a navigation.
    expect(authConfigCalls()).toBe(1);
  });
});
