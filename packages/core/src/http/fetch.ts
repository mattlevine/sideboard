/**
 * HTTP fetch used by Linear (and other Node-side API clients).
 *
 * Electron main should call {@link setHttpFetchImpl} with `net.fetch` so
 * requests use Chromium's network stack. Node's undici `fetch` often fails
 * behind corporate VPN/proxy as an opaque `TypeError: fetch failed`.
 */

let injected: typeof fetch | null = null;

export function setHttpFetchImpl(fetchImpl: typeof fetch | null): void {
  injected = fetchImpl;
}

/** Expand undici/Electron `TypeError: fetch failed` with the underlying cause. */
export function formatFetchError(err: unknown, url: string): string {
  if (!(err instanceof Error)) return `${String(err)} (${url})`;
  const cause = (err as Error & { cause?: unknown }).cause;
  let detail = '';
  if (cause instanceof Error) {
    const code =
      typeof (cause as NodeJS.ErrnoException).code === 'string'
        ? (cause as NodeJS.ErrnoException).code
        : undefined;
    detail = code ? ` [${code}: ${cause.message}]` : ` [${cause.message}]`;
  } else if (cause != null) {
    detail = ` [${String(cause)}]`;
  }
  return `${err.message}${detail} (${url})`;
}

export async function httpFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input.href;
  const fn = injected ?? globalThis.fetch.bind(globalThis);
  try {
    return await fn(url, init);
  } catch (err) {
    throw new Error(formatFetchError(err, url));
  }
}
