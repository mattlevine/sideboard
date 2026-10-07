import type { IncomingMessage, ServerResponse } from 'node:http';
import { escapeHtml } from '../slack/oauth-redirect.js';
import {
  GITHUB_ACCOUNT_ISSUER,
  type RelayAccountStore,
  type RelaySignInIdentity,
} from './accounts.js';

/**
 * Git hosts that can sign a Mac into the relay. GitHub is the only one today.
 * Add a host by extending this list and {@link GIT_HOST_AUTH}.
 */
export const RELAY_GIT_HOSTS = ['github'] as const;

export type RelayGitHost = (typeof RELAY_GIT_HOSTS)[number];

/** The relay signs a Mac in as its git host. */
export type RelayAccountProvider = RelayGitHost;

export type RelayOAuthClient = { clientId: string; clientSecret: string };

export type RelayOAuthConfig = Partial<Record<RelayGitHost, RelayOAuthClient>>;

export const REMOTE_LOGIN_PATH = '/remote/login';
export const REMOTE_OAUTH_CALLBACK_PATH = '/remote/oauth/callback';
export const REMOTE_OAUTH_RESULT_PATH = '/remote/oauth/result';
export const REMOTE_LOGOUT_PATH = '/remote/logout';

const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const LOGIN_TTL_MS = 10 * 60 * 1000;

type PendingLogin = {
  provider: RelayAccountProvider;
  accountId: string | null;
  expiresAt: number;
};

type PendingResult =
  | { ok: true; credential: string; email: string | null; accountId: string }
  | { ok: false; error: string };

/** In-memory only. The OAuth dance is short. The account row is what persists. */
export class RelayLoginSessions {
  private readonly waiting = new Map<string, PendingLogin>();
  private readonly results = new Map<string, { value: PendingResult; expiresAt: number }>();

  begin(state: string, provider: RelayAccountProvider, accountId: string | null): void {
    this.sweep();
    this.waiting.set(state, { provider, accountId, expiresAt: Date.now() + LOGIN_TTL_MS });
  }

  takeLogin(state: string): PendingLogin | null {
    this.sweep();
    const row = this.waiting.get(state);
    if (!row) return null;
    this.waiting.delete(state);
    if (row.expiresAt < Date.now()) return null;
    return row;
  }

  putResult(state: string, value: PendingResult): void {
    this.results.set(state, { value, expiresAt: Date.now() + LOGIN_TTL_MS });
  }

  /** `undefined` means the browser flow has not finished. */
  takeResult(state: string): PendingResult | null | undefined {
    this.sweep();
    const row = this.results.get(state);
    if (!row) return this.waiting.has(state) ? undefined : null;
    this.results.delete(state);
    if (row.expiresAt < Date.now()) return null;
    return row.value;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [state, row] of this.waiting) {
      if (row.expiresAt < now) this.waiting.delete(state);
    }
    for (const [state, row] of this.results) {
      if (row.expiresAt < now) this.results.delete(state);
    }
  }
}

type GitHostAuth = {
  label: string;
  authorizeUrl: string;
  scope: string;
  fetchIdentity(
    client: RelayOAuthClient,
    code: string,
    redirectUri: string,
    fetchImpl: typeof fetch,
  ): Promise<RelaySignInIdentity>;
};

/**
 * One entry per git host. The desktop does not pick a mail provider — the
 * host that owns the repos is the relay account.
 */
const GIT_HOST_AUTH: Record<RelayGitHost, GitHostAuth> = {
  github: {
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    scope: 'user:email',
    fetchIdentity: fetchGithubIdentity,
  },
};

function providerOf(value: string): RelayAccountProvider | null {
  return (RELAY_GIT_HOSTS as readonly string[]).includes(value) ? (value as RelayGitHost) : null;
}

export function relayAuthorizeUrl(
  provider: RelayAccountProvider,
  client: RelayOAuthClient,
  redirectUri: string,
  state: string,
): string {
  const host = GIT_HOST_AUTH[provider];
  const url = new URL(host.authorizeUrl);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', host.scope);
  url.searchParams.set('state', state);
  return url.toString();
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Sign-in provider returned a non-JSON response.');
  }
}

function accessToken(body: unknown): string {
  const token = (body as { access_token?: unknown }).access_token;
  if (typeof token !== 'string' || !token.trim()) {
    const message = (body as { error_description?: unknown; error?: unknown }).error_description;
    throw new Error(typeof message === 'string' && message.trim() ? message : 'Sign-in provider rejected the code.');
  }
  return token.trim();
}

async function fetchGithubIdentity(
  client: RelayOAuthClient,
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch,
): Promise<RelaySignInIdentity> {
  const tokenRes = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const token = accessToken(await readJson(tokenRes));
  const userRes = await fetchImpl('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'sideboard-relay' },
  });
  const user = (await readJson(userRes)) as { id?: unknown };
  const subject = typeof user.id === 'number' ? String(user.id) : '';
  if (!subject) throw new Error('GitHub did not return an account id.');
  const emailRes = await fetchImpl('https://api.github.com/user/emails', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'sideboard-relay' },
  });
  const emails = (await readJson(emailRes)) as Array<{ email?: unknown; primary?: unknown; verified?: unknown }>;
  const list = Array.isArray(emails) ? emails : [];
  const primary = list.find((row) => row.primary === true && row.verified === true);
  const anyVerified = list.find((row) => row.verified === true);
  const chosen = primary ?? anyVerified;
  const email = chosen && typeof chosen.email === 'string' ? chosen.email : null;
  return { issuer: GITHUB_ACCOUNT_ISSUER, subject, email, emailVerified: Boolean(email) };
}

export async function fetchRelayIdentity(
  provider: RelayAccountProvider,
  client: RelayOAuthClient,
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch,
): Promise<RelaySignInIdentity> {
  return GIT_HOST_AUTH[provider].fetchIdentity(client, code, redirectUri, fetchImpl);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 8192) throw new Error('body too large');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, title: string, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`);
}

/**
 * Git-host sign-in for the phone relay. GitHub is the host today; another host
 * is a registry entry. Client secrets stay on the relay. The desktop receives
 * a Sideboard credential, not the provider token.
 */
export async function handleRelayAccountHttp(opts: {
  req: IncomingMessage;
  res: ServerResponse;
  store: RelayAccountStore;
  oauth: RelayOAuthConfig;
  sessions: RelayLoginSessions;
  publicOrigin: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const reqUrl = opts.req.url || '/';
  const path = reqUrl.split('?')[0];
  const method = opts.req.method || 'GET';
  const origin = opts.publicOrigin.replace(/\/+$/, '');
  const redirectUri = `${origin}${REMOTE_OAUTH_CALLBACK_PATH}`;
  const fetchImpl = opts.fetchImpl ?? fetch;

  if (method === 'POST' && path === REMOTE_LOGIN_PATH) {
    let body: { provider?: unknown; state?: unknown; accountToken?: unknown };
    try {
      body = (await readBody(opts.req)) as typeof body;
    } catch {
      sendJson(opts.res, 400, { ok: false, error: 'invalid login request' });
      return true;
    }
    const provider = providerOf(typeof body.provider === 'string' ? body.provider : '');
    const state = typeof body.state === 'string' ? body.state.trim() : '';
    if (!provider || !STATE_RE.test(state)) {
      sendJson(opts.res, 400, { ok: false, error: 'invalid login request' });
      return true;
    }
    const client = opts.oauth[provider];
    if (!client?.clientId || !client.clientSecret) {
      sendJson(opts.res, 503, {
        ok: false,
        error: `${GIT_HOST_AUTH[provider].label} sign-in is not configured on this relay.`,
      });
      return true;
    }
    let accountId: string | null = null;
    const linkToken = typeof body.accountToken === 'string' ? body.accountToken.trim() : '';
    if (linkToken) {
      accountId = opts.store.verifyCredential(linkToken);
      if (!accountId) {
        sendJson(opts.res, 401, { ok: false, error: 'sign in required' });
        return true;
      }
    }
    opts.sessions.begin(state, provider, accountId);
    sendJson(opts.res, 200, { ok: true, url: relayAuthorizeUrl(provider, client, redirectUri, state) });
    return true;
  }

  if (method === 'GET' && path === REMOTE_OAUTH_CALLBACK_PATH) {
    const url = new URL(reqUrl, origin);
    const state = url.searchParams.get('state')?.trim() ?? '';
    const code = url.searchParams.get('code')?.trim() ?? '';
    const providerError = url.searchParams.get('error')?.trim() ?? '';
    const pending = STATE_RE.test(state) ? opts.sessions.takeLogin(state) : null;
    if (!pending) {
      sendHtml(opts.res, 400, 'Sideboard', '<h1>Sign-in expired</h1><p>Return to Sideboard and try again.</p>');
      return true;
    }
    if (providerError || !code) {
      const message = providerError || 'Sign-in was cancelled.';
      opts.sessions.putResult(state, { ok: false, error: message });
      sendHtml(opts.res, 400, 'Sideboard', `<h1>Could not sign in</h1><p>${escapeHtml(message)}</p>`);
      return true;
    }
    const client = opts.oauth[pending.provider];
    if (!client) {
      opts.sessions.putResult(state, { ok: false, error: 'Sign-in is not configured on this relay.' });
      sendHtml(opts.res, 503, 'Sideboard', '<h1>Sign-in is not configured</h1>');
      return true;
    }
    try {
      const identity = await fetchRelayIdentity(pending.provider, client, code, redirectUri, fetchImpl);
      const signed = opts.store.signIn(identity, pending.accountId);
      opts.sessions.putResult(state, {
        ok: true,
        credential: signed.credential,
        email: signed.email,
        accountId: signed.accountId,
      });
      sendHtml(
        opts.res,
        200,
        'Sideboard',
        '<h1>Signed in</h1><p>Return to Sideboard. This window can close.</p>',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.sessions.putResult(state, { ok: false, error: message });
      sendHtml(opts.res, 400, 'Sideboard', `<h1>Could not sign in</h1><p>${escapeHtml(message)}</p>`);
    }
    return true;
  }

  if (method === 'GET' && path === REMOTE_OAUTH_RESULT_PATH) {
    const url = new URL(reqUrl, origin);
    const state = url.searchParams.get('state')?.trim() ?? '';
    if (!STATE_RE.test(state)) {
      sendJson(opts.res, 400, { ok: false, error: 'invalid login request' });
      return true;
    }
    const result = opts.sessions.takeResult(state);
    if (result === undefined || result === null) {
      sendJson(opts.res, 404, { ok: false, error: 'pending' });
      return true;
    }
    if (!result.ok) {
      sendJson(opts.res, 400, { ok: false, error: result.error });
      return true;
    }
    sendJson(opts.res, 200, {
      ok: true,
      credential: result.credential,
      email: result.email,
      accountId: result.accountId,
    });
    return true;
  }

  if (method === 'POST' && path === REMOTE_LOGOUT_PATH) {
    let body: { accountToken?: unknown };
    try {
      body = (await readBody(opts.req)) as typeof body;
    } catch {
      sendJson(opts.res, 400, { ok: false, error: 'invalid logout request' });
      return true;
    }
    const token = typeof body.accountToken === 'string' ? body.accountToken : '';
    opts.store.logout(token);
    sendJson(opts.res, 200, { ok: true });
    return true;
  }

  return false;
}
