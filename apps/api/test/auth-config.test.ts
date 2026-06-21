import { describe, expect, it } from 'vitest';
import { createAuth } from '../src/auth/auth.js';
import type { Db } from '../src/db/index.js';

/**
 * Unit tests for better-auth wiring. These construct the instance with a stub
 * Db (construction issues no queries) so they stay DB-less, and assert the
 * `baseURL` / `trustedOrigins` config that prevents the "Base URL is not set"
 * warning and makes the reverse-proxy origin check deterministic.
 */
const stubDb = {} as Db;
const SECRET = 'test-secret-test-secret-test-secret-123'; // >= 32 chars

describe('createAuth — base URL / trusted origins', () => {
  it('uses BETTER_AUTH_URL as the public baseURL and trusts that origin', () => {
    const auth = createAuth(stubDb, {
      AUTH_SECRET: SECRET,
      BETTER_AUTH_URL: 'https://pulse.example.com',
    });

    expect(auth.options.baseURL).toBe('https://pulse.example.com');
    expect(auth.options.trustedOrigins).toContain('https://pulse.example.com');
  });

  it('mounts at the conventional /api/auth basePath', () => {
    const auth = createAuth(stubDb, {
      AUTH_SECRET: SECRET,
      BETTER_AUTH_URL: 'http://localhost:3000',
    });
    expect(auth.options.basePath).toBe('/api/auth');
  });

  it('omits baseURL/trustedOrigins when BETTER_AUTH_URL is unset (request-inferred)', () => {
    const auth = createAuth(stubDb, { AUTH_SECRET: SECRET });
    expect(auth.options.baseURL).toBeUndefined();
    expect(auth.options.trustedOrigins).toBeUndefined();
  });
});
