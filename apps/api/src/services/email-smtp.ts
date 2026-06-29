/**
 * SMTP transactional-email port — the OSS self-host email provider.
 *
 * Implements the `EmailPort` seam (`./email.ts`) on top of nodemailer. It is the
 * first real provider in the OSS substrate; the cloud package may still bind its
 * own provider via the same interface. Activated only when `EMAIL_PROVIDER=smtp`
 * and `SMTP_HOST` is set (see `resolveEmailPort` / `isEmailConfigured`); otherwise
 * the console no-op default applies so a deploy with no mail config still boots.
 */

import nodemailer from 'nodemailer';
import { isEmailConfigured, type RuntimeConfig } from '../config/runtime.js';
import { createConsoleEmailPort, type EmailMessage, type EmailPort } from './email.js';

/** Resolved SMTP transport settings (from `runtime.email.smtp` + `email.from`). */
export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  secure: boolean;
  /** Envelope/From header; from `EMAIL_FROM`. */
  from?: string;
}

/** The slice of a nodemailer transporter we use — narrowed so tests can fake it. */
export interface MailTransport {
  sendMail(options: {
    from?: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Logical template → rendered email. Kept minimal and inline (no theming) per the
 * design; add a key here when a new transactional mail is introduced.
 */
const TEMPLATES: Record<string, (data: Record<string, unknown>) => RenderedEmail> = {
  'password-reset': (data) => {
    const url = String(data.url ?? '');
    const name = typeof data.name === 'string' && data.name ? data.name : null;
    const greeting = name ? `Hi ${name},` : 'Hi,';
    return {
      subject: 'Reset your PulseDeck password',
      text: `${greeting}\n\nWe received a request to reset your PulseDeck password. Open the link below to choose a new one:\n\n${url}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
      html: `<p>${greeting}</p><p>We received a request to reset your PulseDeck password. Click the link below to choose a new one:</p><p><a href="${url}">Reset your password</a></p><p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`,
    };
  },
};

/**
 * Build an `EmailPort` backed by SMTP. `transport` is injectable so tests exercise
 * rendering + dispatch without a live SMTP server.
 */
export function createSmtpEmailPort(
  cfg: SmtpConfig,
  opts: { transport?: MailTransport } = {},
): EmailPort {
  const transport: MailTransport =
    opts.transport ??
    nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });

  return {
    async send(message: EmailMessage): Promise<void> {
      const render = TEMPLATES[message.template];
      if (!render) {
        throw new Error(`Unknown email template: ${message.template}`);
      }
      const { subject, text, html } = render(message.data);
      await transport.sendMail({ from: cfg.from, to: message.to, subject, text, html });
    },
  };
}

/**
 * Pick the email port for the given runtime: the SMTP port when email is
 * configured (`isEmailConfigured`), else the console no-op. `transport` is
 * forwarded to the SMTP port for tests.
 */
export function resolveEmailPort(opts: {
  runtime: RuntimeConfig;
  logger?: { info: (obj: object, msg?: string) => void };
  transport?: MailTransport;
}): EmailPort {
  const { runtime, logger, transport } = opts;
  if (isEmailConfigured(runtime) && runtime.email.smtp) {
    return createSmtpEmailPort({ ...runtime.email.smtp, from: runtime.email.from }, { transport });
  }
  return createConsoleEmailPort(logger);
}
