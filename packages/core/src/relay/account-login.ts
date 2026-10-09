import { randomBytes } from 'node:crypto';
import { currentHttpFetch, formatFetchError } from '../http/fetch.js';
import { remoteRelayUrl } from '../remote/protocol.js';
import { REMOTE_LOGIN_PATH, REMOTE_LOGOUT_PATH, REMOTE_OAUTH_RESULT_PATH, type RelayAccountProvider } from './account-oauth.js';

export type { RelayAccountProvider };

export class RemoteAccountLoginCancelled extends Error {
  constructor() {
    super('Sign-in cancelled');
    this.name = 'RemoteAccountLoginCancelled';
  }
}

export function isRemoteAccountLoginCancelled(err: unknown): boolean {
  return err instanceof RemoteAccountLoginCancelled;
}

/** `wss://relay.sideboard.cloud/remote` → `https://relay.sideboard.cloud`. */
export function remoteAccountHttpOrigin(wsUrl: string = remoteRelayUrl()): string {
  const url = new URL(wsUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.origin;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RemoteAccountLoginCancelled());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RemoteAccountLoginCancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export type RemoteAccountSession = {
  credential: string;
  email: string | null;
  accountId: string;
};

const RELAY_TLS_HINT =
  ' — the TLS certificate was rejected. A work proxy often does this when Sideboard is not allowlisted, or when the app does not trust the corporate CA.';

const RELAY_NETWORK_HINT =
  ' Sideboard could not reach the relay. On a work computer this is often a VPN, a proxy, or an allowlist that does not include Sideboard.';

const RELAY_NETWORK_RE =
  /fetch failed|Failed to fetch|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|EPERM|UND_ERR_|ERR_CONNECTION|ERR_NETWORK|ERR_PROXY|ERR_TUNNEL|ERR_INTERNET|ERR_BLOCKED|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_CERT|CERT_|UNABLE_TO_GET_ISSUER|SELF_SIGNED/i;

function relayFetchError(err: unknown, url: string): Error {
  const formatted = formatFetchError(err, url, { tlsHint: RELAY_TLS_HINT });
  if (formatted.includes(RELAY_TLS_HINT) || !RELAY_NETWORK_RE.test(formatted)) {
    return new Error(formatted);
  }
  return new Error(`${formatted}${RELAY_NETWORK_HINT}`);
}

async function relayFetch(
  fetchImpl: typeof fetch | undefined,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const fn = fetchImpl ?? currentHttpFetch();
  try {
    return await fn(url, init);
  } catch (err) {
    throw relayFetchError(err, url);
  }
}

async function readJson<T>(res: Response, url: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    const kind = (res.headers.get('content-type') ?? '').includes('html') ? 'an HTML page' : 'a non-JSON body';
    throw new Error(
      `Relay sign-in returned HTTP ${res.status} with ${kind} (${url}). A work proxy or allowlist often answers with a block page instead of the relay.`,
    );
  }
}

/**
 * Open the git host in the browser. The relay holds the client secret and
 * returns a Sideboard credential for this Mac.
 */
export async function startRemoteAccountLogin(opts: {
  provider: RelayAccountProvider;
  /** When set, the new provider is attached to that account. */
  linkToken?: string;
  openUrl?: (url: string) => void | Promise<void>;
  origin?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}): Promise<RemoteAccountSession> {
  if (opts.signal?.aborted) throw new RemoteAccountLoginCancelled();
  const origin = (opts.origin ?? remoteAccountHttpOrigin()).replace(/\/+$/, '');
  const state = randomBytes(16).toString('hex');
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 400;
  const linkToken = opts.linkToken?.trim() ?? '';
  const startUrl = `${origin}${REMOTE_LOGIN_PATH}`;
  const started = await relayFetch(opts.fetchImpl, startUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: opts.provider,
      state,
      ...(linkToken ? { accountToken: linkToken } : {}),
    }),
  });
  const startBody = await readJson<{ ok?: boolean; url?: string; error?: string }>(started, startUrl);
  if (!started.ok || !startBody.url) {
    throw new Error(startBody.error || `Could not start sign-in (HTTP ${started.status}).`);
  }
  await Promise.resolve(opts.openUrl?.(startBody.url));
  const deadline = Date.now() + timeoutMs;
  const resultUrl = `${origin}${REMOTE_OAUTH_RESULT_PATH}?state=${encodeURIComponent(state)}`;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new RemoteAccountLoginCancelled();
    let res: Response;
    try {
      res = await relayFetch(opts.fetchImpl, resultUrl);
    } catch (err) {
      if (opts.signal?.aborted || isRemoteAccountLoginCancelled(err)) {
        throw new RemoteAccountLoginCancelled();
      }
      await sleep(pollIntervalMs, opts.signal);
      continue;
    }
    let data: { ok?: boolean; error?: string; credential?: string; email?: string | null; accountId?: string };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      await sleep(pollIntervalMs, opts.signal);
      continue;
    }
    if (data.ok && data.credential && data.accountId) {
      return {
        credential: data.credential,
        email: data.email ?? null,
        accountId: data.accountId,
      };
    }
    if (data.error && data.error !== 'pending') throw new Error(data.error);
    await sleep(pollIntervalMs, opts.signal);
  }
  throw new Error('Sign-in timed out.');
}

/** Forget this Mac’s credential on the relay. Local vault cleanup is separate. */
export async function disconnectRemoteAccount(opts: {
  accountToken: string;
  origin?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const origin = (opts.origin ?? remoteAccountHttpOrigin()).replace(/\/+$/, '');
  await relayFetch(opts.fetchImpl, `${origin}${REMOTE_LOGOUT_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountToken: opts.accountToken }),
  });
}
