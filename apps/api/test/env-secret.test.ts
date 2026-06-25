import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';

/**
 * AUTH_SECRET hardening (security finding C1): a known placeholder / dev secret
 * must boot in development but be rejected under NODE_ENV=production, so a copied
 * `.env.example` or the local dev dummy can never sign sessions in a real deploy.
 */
describe('AUTH_SECRET placeholder policy', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };
  const DEV_DUMMY = 'dev-only-insecure-auth-secret-change-for-prod';
  const REAL = 'm0pe0C2EtDy+pdn6ejZouTl8oA3J7WP0CZ6XDkfFFVPzEn0OGMBg';

  it('accepts the dev dummy in development', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'development', AUTH_SECRET: DEV_DUMMY }),
    ).not.toThrow();
  });

  it('accepts the dev dummy in test', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'test', AUTH_SECRET: DEV_DUMMY })).not.toThrow();
  });

  it('rejects the dev dummy in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', AUTH_SECRET: DEV_DUMMY })).toThrow(
      /placeholder\/dev value/,
    );
  });

  it('rejects other known placeholders in production', () => {
    for (const weak of [
      'change-me-to-a-long-random-secret-string',
      'please-replace-this-placeholder-value-now',
      'my-insecure-secret-for-the-app-padding-xx',
    ]) {
      expect(() => loadEnv({ ...base, NODE_ENV: 'production', AUTH_SECRET: weak })).toThrow();
    }
  });

  it('accepts a strong unique secret in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', AUTH_SECRET: REAL })).not.toThrow();
  });

  it('still enforces the 32-char minimum regardless of mode', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', AUTH_SECRET: 'short' })).toThrow(
      /at least 32 characters/,
    );
  });
});
