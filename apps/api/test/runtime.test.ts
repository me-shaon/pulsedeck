import { describe, expect, it } from 'vitest';
import { buildRuntimeConfig, isEmailConfigured } from '../src/config/runtime.js';

/**
 * SMTP email config derivation. The OSS default is console no-op (no provider);
 * setting EMAIL_PROVIDER=smtp + SMTP_HOST turns delivery on, which `isEmailConfigured`
 * reports so the UI can warn/gate (forgot-password warning + admin banner).
 */
describe('buildRuntimeConfig — email/SMTP', () => {
  it('leaves smtp undefined and email unconfigured by default (OSS)', () => {
    const rc = buildRuntimeConfig({});
    expect(rc.email.smtp).toBeUndefined();
    expect(isEmailConfigured(rc)).toBe(false);
  });

  it('reports unconfigured when provider=smtp but no host', () => {
    const rc = buildRuntimeConfig({ EMAIL_PROVIDER: 'smtp' });
    expect(isEmailConfigured(rc)).toBe(false);
  });

  it('derives smtp config and reports configured when provider=smtp + host set', () => {
    const rc = buildRuntimeConfig({
      EMAIL_PROVIDER: 'smtp',
      EMAIL_FROM: 'PulseDeck <no-reply@example.com>',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 2525,
      SMTP_USER: 'apikey',
      SMTP_PASS: 'secret',
      SMTP_SECURE: true,
    });
    expect(rc.email.provider).toBe('smtp');
    expect(rc.email.from).toBe('PulseDeck <no-reply@example.com>');
    expect(rc.email.smtp).toEqual({
      host: 'smtp.example.com',
      port: 2525,
      user: 'apikey',
      pass: 'secret',
      secure: true,
    });
    expect(isEmailConfigured(rc)).toBe(true);
  });

  it('defaults smtp port to 587 and secure to false when omitted', () => {
    const rc = buildRuntimeConfig({ EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.com' });
    expect(rc.email.smtp).toMatchObject({ host: 'smtp.example.com', port: 587, secure: false });
    expect(isEmailConfigured(rc)).toBe(true);
  });
});
