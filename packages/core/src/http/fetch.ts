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

function isTlsIssuerFailure(code: string | undefined, message: string): boolean {
  return TLS_ISSUER_RE.test(`${code ?? ''} ${message}`);
}

type CauseDetail = { code?: string; message: string };

/** Undici often hides the socket error on `cause`, sometimes inside AggregateError. */
function describeCause(cause: unknown, depth = 0): CauseDetail | null {
  if (depth > 5 || cause == null) return null;
  if (cause instanceof AggregateError) {
    for (const item of cause.errors) {
      const found = describeCause(item, depth + 1);
      if (found && (found.code || found.message)) return found;
    }
    return cause.message ? { message: cause.message } : null;
  }
  if (cause instanceof Error) {
    const code =
      typeof (cause as NodeJS.ErrnoException).code === 'string'
        ? (cause as NodeJS.ErrnoException).code
        : undefined;
    const nested = describeCause((cause as Error & { cause?: unknown }).cause, depth + 1);
    if ((!cause.message || cause.message === 'fetch failed') && nested) return nested;
    if (cause.message || code) return { code, message: cause.message };
    return nested;
  }
  return { message: String(cause) };
}

function causeSuffix(detail: CauseDetail | null): string {
  if (!detail) return '';
  if (detail.code && detail.message) return ` [${detail.code}: ${detail.message}]`;
  if (detail.code) return ` [${detail.code}]`;
  if (detail.message) return ` [${detail.message}]`;
  return '';
}

/**
 * Expand undici/Electron `TypeError: fetch failed` with the underlying cause.
 * `tlsHint` replaces the default Linear certificate note when the failure is a
 * corporate CA rejection. Pass '' to omit that note.
 */
export function formatFetchError(
  err: unknown,
  url: string,
  opts?: { tlsHint?: string },
): string {
  if (!(err instanceof Error)) return `${String(err)} (${url})`;
  const detail = describeCause((err as Error & { cause?: unknown }).cause);
  const hintSource = `${err.message} ${detail?.code ?? ''} ${detail?.message ?? ''}`;
  const tls = isTlsIssuerFailure(detail?.code, hintSource);
  const hint = tls ? (opts?.tlsHint ?? TLS_ISSUER_HINT) : '';
  return `${err.message}${causeSuffix(detail)} (${url})${hint}`;
}

/** Chromium `net.fetch` when Electron injected it; otherwise Node `fetch`. */
export function currentHttpFetch(): typeof fetch {
  return injected ?? globalThis.fetch.bind(globalThis);
}

export async function httpFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input.href;
  try {
    return await currentHttpFetch()(url, init);
  } catch (err) {
    throw new Error(formatFetchError(err, url));
  }
}
