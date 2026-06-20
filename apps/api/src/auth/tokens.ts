import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';

/**
 * Credential generation + hashing for the source registration/API-key system.
 *
 * Two opaque bearer credentials exist, each a prefix + high-entropy random tail:
 *   - `reg_<random>` — a one-time registration token (handed to an admin once).
 *   - `pd_<random>`  — a source's long-lived API key (handed to an agent once).
 *
 * SECURITY: only SHA-256 hashes of these values are ever persisted. The raw
 * value is returned to the caller exactly once at creation/rotation/registration
 * and never stored or logged. Lookups hash the presented value and match it
 * against the indexed hash column — never a plaintext comparison.
 */

/** Human-recognizable prefixes (also used to fail fast on obviously wrong creds). */
export const REG_TOKEN_PREFIX = 'reg_';
export const API_KEY_PREFIX = 'pd_';

/** Entropy of the random tail. 36 url-safe nanoid chars ≈ 216 bits. */
const SECRET_SIZE = 36;

/** Mint a fresh one-time registration token (`reg_...`). Raw — hash before storing. */
export function generateRegToken(): string {
  return `${REG_TOKEN_PREFIX}${nanoid(SECRET_SIZE)}`;
}

/** Mint a fresh source API key (`pd_...`). Raw — hash before storing. */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${nanoid(SECRET_SIZE)}`;
}

/** SHA-256 hex digest of a raw credential. The only form that touches the DB. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** True when `raw` looks like a source API key (cheap shape check, not auth). */
export function looksLikeApiKey(raw: string): boolean {
  return raw.startsWith(API_KEY_PREFIX);
}
