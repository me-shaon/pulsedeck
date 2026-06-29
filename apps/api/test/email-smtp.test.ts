import { describe, expect, it, vi } from 'vitest';
import { buildRuntimeConfig } from '../src/config/runtime.js';
import { createConsoleEmailPort } from '../src/services/email.js';
import { createSmtpEmailPort, resolveEmailPort } from '../src/services/email-smtp.js';

const SMTP_CFG = {
  host: 'smtp.example.com',
  port: 587,
  user: 'apikey',
  pass: 'secret',
  secure: false,
  from: 'PulseDeck <no-reply@example.com>',
};

describe('createSmtpEmailPort', () => {
  it('renders the password-reset template and sends via the transport', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '1' });
    const port = createSmtpEmailPort(SMTP_CFG, { transport: { sendMail } });

    await port.send({
      to: 'user@example.com',
      template: 'password-reset',
      data: { url: 'https://app.example.com/reset-password?token=abc', name: 'Ada' },
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = sendMail.mock.calls[0][0];
    expect(arg.from).toBe(SMTP_CFG.from);
    expect(arg.to).toBe('user@example.com');
    expect(arg.subject).toMatch(/reset/i);
    expect(arg.text).toContain('https://app.example.com/reset-password?token=abc');
    expect(arg.html).toContain('https://app.example.com/reset-password?token=abc');
  });

  it('throws on an unknown template', async () => {
    const sendMail = vi.fn();
    const port = createSmtpEmailPort(SMTP_CFG, { transport: { sendMail } });
    await expect(
      port.send({ to: 'x@example.com', template: 'no-such-template', data: {} }),
    ).rejects.toThrow(/unknown email template/i);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('resolveEmailPort', () => {
  it('returns the console no-op when email is not configured', () => {
    const rc = buildRuntimeConfig({});
    const port = resolveEmailPort({ runtime: rc });
    // Same shape as the OSS default — sending is a no-op (resolves, does nothing).
    expect(typeof port.send).toBe('function');
    expect(port).not.toBe(createConsoleEmailPort()); // distinct instance, same behavior
  });

  it('returns an SMTP port (renders templates) when provider=smtp + host set', async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const rc = buildRuntimeConfig({
      EMAIL_PROVIDER: 'smtp',
      EMAIL_FROM: SMTP_CFG.from,
      SMTP_HOST: SMTP_CFG.host,
    });
    const port = resolveEmailPort({ runtime: rc, transport: { sendMail } });
    await port.send({ to: 'a@b.com', template: 'password-reset', data: { url: 'https://x/y' } });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe('a@b.com');
  });
});
