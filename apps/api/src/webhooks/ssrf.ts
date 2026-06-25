import { lookup as dnsLookupCb } from 'node:dns';
import { lookup } from 'node:dns/promises';

/**
 * SSRF guard for outbound webhook URLs (PRD "Webhooks — security").
 *
 * Multi-tenant cloud accepts user-supplied URLs against shared infrastructure,
 * so a webhook must never be coerced into hitting loopback, RFC1918, link-local,
 * or the cloud metadata endpoint (169.254.169.254). The policy is one flag,
 * {@link RuntimeConfig.webhook.allowPrivateIps} — allowed on self-host (internal
 * Slack/services are legitimate targets), blocked on cloud.
 *
 * Defense is layered:
 *   1. {@link assertUrlAllowed} at create/update (fail fast, clear error) and
 *      again before each send — this catches literal IPs and bad schemes.
 *   2. {@link makeSsrfLookup} installed on the delivery agent's connector, so the
 *      address the socket actually connects to is the one that was validated.
 *      Re-resolving before send is NOT enough on its own: the HTTP client would
 *      resolve the name a second time, and a rebinding attacker can return a
 *      public IP to the check and a private IP to that second resolution. Pinning
 *      the connect-time lookup closes that TOCTOU window.
 */

export class WebhookUrlError extends Error {
  readonly statusCode = 422;
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlError';
  }
}

/** Parse a dotted-quad IPv4 to a 32-bit unsigned int, or null if not IPv4. */
function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** True for an IPv4 in any loopback/private/link-local/reserved/metadata range. */
function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n == null) return false;
  const inRange = (base: string, bits: number): boolean => {
    const b = ipv4ToInt(base);
    if (b == null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange('0.0.0.0', 8) || // "this" network / unspecified
    inRange('10.0.0.0', 8) || // private
    inRange('100.64.0.0', 10) || // carrier-grade NAT
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local (incl. 169.254.169.254 metadata)
    inRange('172.16.0.0', 12) || // private
    inRange('192.0.0.0', 24) || // IETF protocol assignments
    inRange('192.168.0.0', 16) || // private
    inRange('198.18.0.0', 15) || // benchmarking
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved (incl. 255.255.255.255 broadcast)
  );
}

/**
 * Expand an IPv6 literal to its 16 bytes, or null if it doesn't parse. Handles
 * `::` compression and a trailing embedded IPv4 (`::ffff:1.2.3.4`). Working on
 * the raw bytes — instead of string-prefix matching a URL-normalized hostname —
 * is what closes the IPv4-mapped-in-hex bypass (e.g. `::ffff:a9fe:a9fe`), since
 * the embedded address is recovered regardless of how the literal was written.
 */
function ipv6ToBytes(ip: string): Uint8Array | null {
  const addr = ip.toLowerCase().split('%')[0]; // strip zone id
  if (!addr.includes(':')) return null;

  // A trailing dotted-quad (e.g. `::ffff:1.2.3.4`) contributes the last 4 bytes.
  let tailV4: number[] | null = null;
  let head = addr;
  const lastColon = addr.lastIndexOf(':');
  const afterColon = addr.slice(lastColon + 1);
  if (afterColon.includes('.')) {
    const v4 = ipv4ToInt(afterColon);
    if (v4 == null) return null;
    tailV4 = [(v4 >>> 24) & 0xff, (v4 >>> 16) & 0xff, (v4 >>> 8) & 0xff, v4 & 0xff];
    head = addr.slice(0, lastColon + 1) + '0:0'; // placeholder hextets for the v4
  }

  const parts = head.split('::');
  if (parts.length > 2) return null; // at most one `::`
  const toHextets = (s: string): number[] => {
    if (s === '') return [];
    return s.split(':').map((h) => parseInt(h, 16));
  };
  const left = toHextets(parts[0]);
  const right = parts.length === 2 ? toHextets(parts[1]) : null;

  let hextets: number[];
  if (right === null) {
    hextets = left;
  } else {
    const fill = 8 - (left.length + right.length);
    if (fill < 0) return null;
    hextets = [...left, ...Array(fill).fill(0), ...right];
  }
  if (hextets.length !== 8 || hextets.some((h) => Number.isNaN(h) || h < 0 || h > 0xffff)) {
    return null;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (hextets[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = hextets[i] & 0xff;
  }
  if (tailV4) bytes.set(tailV4, 12);
  return bytes;
}

/** True for an IPv6 loopback/unspecified/ULA/link-local, or a blocked mapped IPv4. */
function isBlockedIpv6(ip: string): boolean {
  const bytes = ipv6ToBytes(ip);
  if (!bytes) return true; // unparseable → fail closed

  const allZeroPrefix = (n: number): boolean => bytes.slice(0, n).every((b) => b === 0);

  // Loopback ::1 and unspecified ::
  if (allZeroPrefix(15)) return bytes[15] === 0 || bytes[15] === 1;

  // Embedded-IPv4 forms — recover the v4 and apply the v4 policy:
  //   ::ffff:0:0/96 (IPv4-mapped) and ::/96 (IPv4-compatible, deprecated).
  const embeddedV4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
  if (allZeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff)
    return isBlockedIpv4(embeddedV4);
  if (allZeroPrefix(12)) return isBlockedIpv4(embeddedV4);
  // NAT64 well-known prefix 64:ff9b::/96 — the embedded v4 is the real target.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return isBlockedIpv4(embeddedV4);
  }

  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  return false;
}

/** True if a literal IP address is in a blocked range (either family). */
export function isBlockedIp(ip: string): boolean {
  return ip.includes(':') ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

/**
 * Validate the syntactic shape of a webhook URL. Throws {@link WebhookUrlError}
 * for anything but an `http(s)` absolute URL. Does NOT resolve DNS — call
 * {@link assertUrlAllowed} for the network-level (SSRF) check.
 */
export function parseWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlError('Webhook URL must be a valid absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebhookUrlError('Webhook URL must use http or https');
  }
  return url;
}

/**
 * Resolve the URL's host and reject if any resolved address is in a blocked
 * range (unless `allowPrivateIps`). Used at create/update AND before each send.
 * A host that fails to resolve is rejected (can't prove it's safe).
 */
export async function assertUrlAllowed(
  raw: string,
  allowPrivateIps: boolean,
  resolver: (host: string) => Promise<string[]> = defaultResolver,
): Promise<URL> {
  const url = parseWebhookUrl(raw);
  if (allowPrivateIps) return url;

  const host = url.hostname.replace(/^\[|\]$/g, ''); // unwrap [::1]
  let addresses: string[];
  try {
    addresses = isLiteralIp(host) ? [host] : await resolver(host);
  } catch {
    throw new WebhookUrlError(`Webhook host could not be resolved: ${host}`);
  }
  if (addresses.length === 0) {
    throw new WebhookUrlError(`Webhook host could not be resolved: ${host}`);
  }
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new WebhookUrlError(
        'Webhook URL resolves to a private or reserved address, which is not allowed',
      );
    }
  }
  return url;
}

/** Whether a string is an IP literal (so we skip a DNS round-trip). */
function isLiteralIp(host: string): boolean {
  return host.includes(':') || ipv4ToInt(host) != null;
}

/** Production resolver: all A/AAAA records for a host. */
async function defaultResolver(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((r) => r.address);
}

/** `dns.lookup`-compatible signature undici's connector consumes. */
export type SsrfLookup = (
  hostname: string,
  options: { all?: boolean; family?: number; [k: string]: unknown },
  callback: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
) => void;

/**
 * Build a `dns.lookup`-compatible function for undici's connector. It resolves
 * the host, rejects the whole connection if ANY returned address is blocked, and
 * otherwise hands the validated addresses straight to the socket — so the IP that
 * was checked is the IP that is connected to. This is the connect-time pin that
 * closes the DNS-rebinding/TOCTOU window (the check and the connection share one
 * resolution). For literal-IP hosts undici skips lookup, so {@link isBlockedIp}
 * via {@link assertUrlAllowed} remains the guard there.
 */
export function makeSsrfLookup(): SsrfLookup {
  return (hostname, options, callback) => {
    dnsLookupCb(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err, undefined);
      const list = addresses as unknown as Array<{ address: string; family: number }>;
      const blocked = list.find((a) => isBlockedIp(a.address));
      if (blocked) {
        return callback(
          new WebhookUrlError(
            'Webhook URL resolves to a private or reserved address, which is not allowed',
          ),
          undefined,
        );
      }
      // Honor both calling conventions: array form when `all`, else first match.
      if (options.all) return callback(null, list as unknown);
      return callback(null, list[0].address, list[0].family);
    });
  };
}
