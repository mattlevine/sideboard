/**
 * HTTP fetch used by Linear (and other Node-side API clients).
 *
 * Electron main should call {@link setHttpFetchImpl} with `net.fetch` so
 * requests use Chromium's network stack (create-worktree issue picker).
 * Agent Linear tools run in a Node MCP process — call
 * `trustSystemCertificates` / `applySystemCaEnv` so undici trusts Keychain
 * CAs. Node's undici `fetch` otherwise fails behind corporate VPN/proxy as
 * an opaque `TypeError: fetch failed` or `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`.
 */

let injected: typeof fetch | null = null;

export function setHttpFetchImpl(fetchImpl: typeof fetch | null): void {
  injected = fetchImpl;
}

const TLS_ISSUER_RE =
  /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN/i;

const TLS_ISSUER_HINT =
  ' — Node rejected the TLS certificate (corporate VPN/proxy CA). Desktop Linear can still work; reconnecting the API key will not fix this.';

function tlsIssuerHint(code: string | undefined, message: string): string {
  const text = `${code ?? ''} ${message}`;
  return TLS_ISSUER_RE.test(text) ? TLS_ISSUER_HINT : '';
}

/** Expand undici/Electron `TypeError: fetch failed` with the underlying cause. */
export function formatFetchError(err: unknown, url: string): string {
  if (!(err instanceof Error)) return `${String(err)} (${url})`;
  const cause = (err as Error & { cause?: unknown }).cause;
  let detail = '';
  let hint = tlsIssuerHint(undefined, err.message);
  if (cause instanceof Error) {
    const code =
      typeof (cause as NodeJS.ErrnoException).code === 'string'
        ? (cause as NodeJS.ErrnoException).code
        : undefined;
    detail = code ? ` [${code}: ${cause.message}]` : ` [${cause.message}]`;
    hint = tlsIssuerHint(code, `${err.message} ${cause.message}`) || hint;
  } else if (cause != null) {
    detail = ` [${String(cause)}]`;
    hint = tlsIssuerHint(undefined, String(cause)) || hint;
  }
  return `${err.message}${detail} (${url})${hint}`;
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
