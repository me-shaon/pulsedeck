import { Agent } from 'undici';
import { assertUrlAllowed, makeSsrfLookup, WebhookUrlError } from './ssrf.js';

/**
 * SSRF-safe outbound HTTP for webhook delivery.
 *
 * Two protections wrap the raw fetch:
 *   - a dispatcher whose connector resolves+validates the host once and connects
 *     to that exact address (DNS-rebinding/TOCTOU defense — see makeSsrfLookup);
 *   - manual redirect handling that re-validates every hop, so a public target
 *     cannot 3xx-bounce the request onto an internal address.
 *
 * When private IPs are allowed (self-host default) the dispatcher is omitted —
 * internal targets are legitimate — but redirects are still followed manually so
 * a 3xx is delivered rather than mis-recorded as a non-2xx failure.
 */

/** Default cap on redirect hops; a chain longer than this fails terminally. */
const MAX_REDIRECTS = 3;

/**
 * A dispatcher that pins connections to validated IPs, or `undefined` when
 * private IPs are allowed (no SSRF restriction to enforce). Construct once per
 * runner and reuse across deliveries.
 */
export function createWebhookDispatcher(allowPrivateIps: boolean): Agent | undefined {
  if (allowPrivateIps) return undefined;
  // `lookup` runs on every connect, including each redirect hop's connection.
  return new Agent({ connect: { lookup: makeSsrfLookup() as never } });
}

export interface GuardedFetchOptions {
  fetchImpl: typeof fetch;
  dispatcher?: Agent;
  allowPrivateIps: boolean;
  maxRedirects?: number;
}

/**
 * Fetch with SSRF guards. Validates the URL (and each redirect target) up front,
 * pins the connection via the dispatcher, and follows redirects manually so no
 * hop escapes validation. Throws {@link WebhookUrlError} for a blocked target or
 * an over-long redirect chain so the caller can fail the delivery terminally.
 */
export async function guardedFetch(
  url: string,
  init: RequestInit,
  opts: GuardedFetchOptions,
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  let currentUrl = url;

  for (let hop = 0; ; hop++) {
    // Re-check scheme + literal-IP before every hop. The dispatcher additionally
    // pins the resolved IP for DNS hostnames at connect time.
    await assertUrlAllowed(currentUrl, opts.allowPrivateIps);

    let res: Response;
    try {
      res = await opts.fetchImpl(currentUrl, {
        ...init,
        redirect: 'manual',
        // `dispatcher` is an undici-specific init field; harmless to injected fakes.
        ...(opts.dispatcher ? { dispatcher: opts.dispatcher } : {}),
      } as RequestInit);
    } catch (err) {
      // A blocked address surfaces from the connector as the error's cause —
      // re-throw it as a WebhookUrlError so delivery treats it as terminal.
      const cause = (err as { cause?: unknown })?.cause;
      if (cause instanceof WebhookUrlError) throw cause;
      throw err;
    }

    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;

    if (hop >= maxRedirects) {
      throw new WebhookUrlError(`Webhook exceeded ${maxRedirects} redirects`);
    }
    currentUrl = new URL(location, currentUrl).toString();
  }
}
