import { randomBytes } from 'node:crypto';
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

/**
 * Open Google or GitHub in the browser. The relay holds the client secret and
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
  const fetchImpl = opts.fetchImpl ?? fetch;
  const state = randomBytes(16).toString('hex');
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 400;
  const linkToken = opts.linkToken?.trim() ?? '';
  const started = await fetchImpl(`${origin}${REMOTE_LOGIN_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: opts.provider,
      state,
      ...(linkToken ? { accountToken: linkToken } : {}),
    }),
  });
  const startBody = (await started.json()) as { ok?: boolean; url?: string; error?: string };
  if (!started.ok || !startBody.url) {
    throw new Error(startBody.error || 'Could not start sign-in.');
  }
  await Promise.resolve(opts.openUrl?.(startBody.url));
  const deadline = Date.now() + timeoutMs;
  const resultUrl = `${origin}${REMOTE_OAUTH_RESULT_PATH}?state=${encodeURIComponent(state)}`;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new RemoteAccountLoginCancelled();
    let res: Response;
    try {
      res = await fetchImpl(resultUrl);
    } catch {
      if (opts.signal?.aborted) throw new RemoteAccountLoginCancelled();
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
  const fetchImpl = opts.fetchImpl ?? fetch;
  await fetchImpl(`${origin}${REMOTE_LOGOUT_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountToken: opts.accountToken }),
  });
}
