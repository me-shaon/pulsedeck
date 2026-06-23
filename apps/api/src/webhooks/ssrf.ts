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
 * The check runs TWICE: at create/update (fail fast, clear error) AND again in
 * the runner immediately before each POST (re-resolving the host defeats DNS
 * rebinding, where a name resolves public at create time and private at send).
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

/** True for an IPv6 loopback/unspecified/ULA/link-local, or a blocked mapped IPv4. */
function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0]; // strip zone id
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) — apply the v4 policy to the embedded address.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (mapped) return isBlockedIpv4(mapped[1]);
  const head = addr.split(':')[0] ?? '';
  if (head.startsWith('fc') || head.startsWith('fd')) return true; // fc00::/7 ULA
  if (
    head.startsWith('fe8') ||
    head.startsWith('fe9') ||
    head.startsWith('fea') ||
    head.startsWith('feb')
  )
    return true; // fe80::/10 link-local
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
