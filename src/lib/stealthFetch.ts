/**
 * Shared fetch for public data feeds.
 *
 * The name is historical. This used to forge a residential IP in
 * X-Forwarded-For and X-Real-IP and rotate browser fingerprints so a
 * rate-limited feed would treat the server as a household. That spoofing is
 * gone. Callers still get a timeout and an identifying User-Agent.
 */

const UA = 'OSIRIS/1.0 (public OSINT dashboard; +https://github.com/Maximum-2016/osiris)';

/**
 * Headers for a feed request. Extra headers win, so a caller can set its own
 * User-Agent. No client IP is invented.
 */
export function stealthHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  return {
    'User-Agent': UA,
    'Accept-Language': 'en-US,en;q=0.9',
    ...extraHeaders,
  };
}

/**
 * fetch() with the headers above and a 30s ceiling. Same signature as fetch().
 */
export async function stealthFetch(
  url: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const headers = stealthHeaders(
    init?.headers ? Object.fromEntries(
      init.headers instanceof Headers
        ? init.headers.entries()
        : Array.isArray(init.headers)
          ? init.headers
          : Object.entries(init.headers)
    ) : undefined
  );

  const controller = new AbortController();
  if (init?.signal) {
    init.signal.addEventListener('abort', () => controller.abort());
  }

  const timeoutId = setTimeout(() => controller.abort(new Error('Feed request timed out')), 30000);

  try {
    const res = await fetch(url, { ...init, headers, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
