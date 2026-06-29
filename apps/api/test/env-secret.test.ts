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

/**
 * DATABASE_URL password hardening (security finding C2): the default/dev DB
 * password must boot in development but be rejected under NODE_ENV=production.
 */
describe('DATABASE_URL password policy', () => {
  const STRONG_SECRET = 'm0pe0C2EtDy+pdn6ejZouTl8oA3J7WP0CZ6XDkfFFVPzEn0OGMBg';
  const prod = (databaseUrl: string) =>
    loadEnv({ NODE_ENV: 'production', AUTH_SECRET: STRONG_SECRET, DATABASE_URL: databaseUrl });

  it('accepts the dev DB password in development', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'development',
        AUTH_SECRET: 'dev-only-insecure-auth-secret-change-for-prod',
        DATABASE_URL: 'postgres://pulsedeck:pulsedeck@localhost:5432/pulsedeck',
      }),
    ).not.toThrow();
  });

  it('rejects default/dev DB passwords in production', () => {
    for (const pw of ['pulsedeck', 'postgres', 'password', 'root', 'admin']) {
      expect(() => prod(`postgres://pulsedeck:${pw}@db:5432/pulsedeck`)).toThrow(
        /default\/dev database password/,
      );
    }
  });

  it('rejects an empty DB password in production', () => {
    expect(() => prod('postgres://pulsedeck@db:5432/pulsedeck')).toThrow(
      /default\/dev database password/,
    );
  });

  it('accepts a strong unique DB password in production', () => {
    expect(() => prod('postgres://pulsedeck:8f3c2a1b9d7e4f60a5c8@db:5432/pulsedeck')).not.toThrow();
  });
});

/**
 * SMTP env coercion. The docker-compose passthrough sends `SMTP_PORT=""` when the
 * var is unset; an empty string must mean "use the default", not coerce to 0 and
 * abort boot via `.positive()`.
 */
describe('SMTP_PORT coercion', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    AUTH_SECRET: 'm0pe0C2EtDy+pdn6ejZouTl8oA3J7WP0CZ6XDkfFFVPzEn0OGMBg',
  };

  it('treats an empty SMTP_PORT as unset (does not abort boot)', () => {
    const env = loadEnv({ ...base, SMTP_PORT: '' });
    expect(env.SMTP_PORT).toBeUndefined();
  });

  it('coerces a numeric SMTP_PORT', () => {
    expect(loadEnv({ ...base, SMTP_PORT: '2525' }).SMTP_PORT).toBe(2525);
  });
});
