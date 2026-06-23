import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * HMAC signing for the generic webhook envelope (PRD "Webhooks — security").
 *
 * The runner sends `X-PulseDeck-Signature: sha256=<hex>` where the digest is an
 * HMAC-SHA256 of the raw request body keyed by the webhook's secret. A consumer
 * recomputes the same digest over the bytes it received and compares in constant
 * time. The timestamp header (set by the runner) lets the consumer reject stale
 * replays. Only the generic format is signed — see {@link WebhookFormatter}.
 */

const PREFIX = 'sha256=';

/** Generate a webhook signing secret (URL-safe, high-entropy). */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/** Compute the `sha256=<hex>` signature of `body` under `secret`. */
export function signBody(secret: string, body: string): string {
  return PREFIX + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

/**
 * Constant-time verify a signature header against `body`. Exposed for tests and
 * for documenting the verification recipe; the runner only ever signs.
 */
export function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = signBody(secret, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
