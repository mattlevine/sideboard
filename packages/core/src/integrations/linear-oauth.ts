import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  disconnectLinearConnection,
  loadAppSettings,
  saveLinearOAuth,
  type AppSettings,
} from '../store/app-settings.js';
import {
  BAKED_LINEAR_CLIENT_ID,
  BAKED_LINEAR_CLIENT_SECRET,
  hasBakedLinearOAuth,
} from './linear-app.js';

export { hasBakedLinearOAuth };

/** Fixed port so the Linear OAuth redirect URI can be registered once. */
export const LINEAR_OAUTH_PORT = 19848;
export const LINEAR_OAUTH_REDIRECT = `http://127.0.0.1:${LINEAR_OAUTH_PORT}/callback`;

const LINEAR_AUTHORIZE = 'https://linear.app/oauth/authorize';
const LINEAR_TOKEN = 'https://api.linear.app/oauth/token';
const LINEAR_REVOKE = 'https://api.linear.app/oauth/revoke';
const LINEAR_GRAPHQL = 'https://api.linear.app/graphql';

/** Read-only — Sideboard lists assigned issues; it does not create them. */
export const LINEAR_OAUTH_SCOPES = 'read';

const REFRESH_SKEW_MS = 5 * 60_000;

export function linearOAuthCredentials(): { clientId: string; clientSecret: string } {
  const settings = loadAppSettings();
  const clientId =
    process.env.SIDEBOARD_LINEAR_CLIENT_ID?.trim() ||
    settings.integrations.linearClientId?.trim() ||
    BAKED_LINEAR_CLIENT_ID.trim();
  const clientSecret =
    process.env.SIDEBOARD_LINEAR_CLIENT_SECRET?.trim() ||
    settings.integrations.linearClientSecret?.trim() ||
    BAKED_LINEAR_CLIENT_SECRET.trim();
  if (!clientId) {
    throw new Error(
      `Linear browser sign-in needs a Linear OAuth app Client ID. Create one at linear.app/settings/api/applications/new with callback ${LINEAR_OAUTH_REDIRECT}, then set SIDEBOARD_LINEAR_CLIENT_ID (PKCE does not require a secret). You can still paste a personal API key.`,
    );
  }
  return { clientId, clientSecret };
}

export function createLinearPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function linearOAuthAuthorizeUrl(
  clientId: string,
  state: string,
  codeChallenge: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: LINEAR_OAUTH_REDIRECT,
    response_type: 'code',
    scope: LINEAR_OAUTH_SCOPES,
    state,
    prompt: 'consent',
    actor: 'user',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${LINEAR_AUTHORIZE}?${params.toString()}`;
}

/** Authorization header for Linear GraphQL: personal keys as-is, OAuth as Bearer. */
export function linearAuthorizationHeader(token: string): string {
  const t = token.trim();
  if (!t) return t;
  if (/^bearer\s+/i.test(t)) return t;
  if (t.startsWith('lin_api_')) return t;
  return `Bearer ${t}`;
}

interface LinearTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string | string[];
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;padding:48px 24px;max-width:36rem;margin:0 auto;color:#1a1a1a}
h1{font-size:1.25rem}p{line-height:1.5;color:#444}</style></head><body>${body}</body></html>`;
}

async function exchangeLinearToken(body: URLSearchParams): Promise<LinearTokenResponse> {
  const res = await fetch(LINEAR_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as LinearTokenResponse;
  if (!res.ok || data.error || !data.access_token?.trim()) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Linear OAuth token exchange failed: ${detail}`);
  }
  return data;
}

async function persistLinearTokens(
  data: LinearTokenResponse,
  viewer?: { name?: string; organizationName?: string },
): Promise<AppSettings> {
  return saveLinearOAuth({
    accessToken: data.access_token!.trim(),
    refreshToken: data.refresh_token?.trim(),
    expiresIn: data.expires_in,
    viewerName: viewer?.name,
    organizationName: viewer?.organizationName,
  });
}

async function fetchLinearViewer(
  accessToken: string,
): Promise<{ name?: string; organizationName?: string }> {
  const res = await fetch(LINEAR_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: linearAuthorizationHeader(accessToken),
    },
    body: JSON.stringify({
      query: '{ viewer { name organization { name } } }',
    }),
  });
  if (!res.ok) return {};
  const json = (await res.json().catch(() => ({}))) as {
    data?: { viewer?: { name?: string; organization?: { name?: string } } };
  };
  const viewer = json.data?.viewer;
  return {
    name: viewer?.name?.trim() || undefined,
    organizationName: viewer?.organization?.name?.trim() || undefined,
  };
}

let refreshInFlight: Promise<string> | null = null;

async function refreshLinearAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = linearOAuthCredentials();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  if (clientSecret) body.set('client_secret', clientSecret);
  try {
    const data = await exchangeLinearToken(body);
    await persistLinearTokens(data);
    return data.access_token!.trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/invalid_grant|invalid_token|unauthorized/i.test(message)) {
      disconnectLinearConnection();
      throw new Error('Linear sign-in expired — connect again in Account settings');
    }
    throw err;
  }
}

/**
 * Token for Linear GraphQL: valid OAuth access token (refreshing if needed),
 * else a stored personal API key.
 */
export async function getLinearAuthToken(
  settings = loadAppSettings(),
): Promise<string | null> {
  const access = settings.integrations.linearAccessToken?.trim() || '';
  const refresh = settings.integrations.linearRefreshToken?.trim() || '';
  const expiresAt = settings.integrations.linearTokenExpiresAt ?? 0;
  const apiKey = settings.integrations.linearApiKey?.trim() || '';

  if (access && (!refresh || Date.now() < expiresAt - REFRESH_SKEW_MS)) {
    return access;
  }
  if (refresh) {
    if (!refreshInFlight) {
      refreshInFlight = refreshLinearAccessToken(refresh).finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight.catch((err) => {
      if (apiKey) return apiKey;
      throw err;
    });
  }
  return apiKey || null;
}

export const LINEAR_OAUTH_CANCELLED = 'Linear sign-in cancelled';

export class LinearOAuthCancelledError extends Error {
  constructor(message = LINEAR_OAUTH_CANCELLED) {
    super(message);
    this.name = 'LinearOAuthCancelledError';
  }
}

export function isLinearOAuthCancelled(err: unknown): boolean {
  if (err instanceof LinearOAuthCancelledError) return true;
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes(LINEAR_OAUTH_CANCELLED)) return true;
  return err instanceof Error && err.name === 'LinearOAuthCancelledError';
}

/**
 * Open Linear OAuth in the browser, listen on a localhost callback, store tokens.
 * Pass `signal` so Settings Cancel / closing the modal can abort the wait.
 */
export async function startLinearOAuth(opts?: {
  openUrl?: (url: string) => void | Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AppSettings> {
  if (opts?.signal?.aborted) {
    throw new LinearOAuthCancelledError();
  }
  const { clientId, clientSecret } = linearOAuthCredentials();
  const state = randomBytes(16).toString('hex');
  const pkce = createLinearPkce();
  const authorizeUrl = linearOAuthAuthorizeUrl(clientId, state, pkce.challenge);
  const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;

  const code = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(value!);
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${LINEAR_OAUTH_PORT}`);
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const err = url.searchParams.get('error');
        const gotState = url.searchParams.get('state');
        const gotCode = url.searchParams.get('code');
        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(htmlPage('Linear', `<h1>Authorization cancelled</h1><p>${err}</p>`));
          finish(new LinearOAuthCancelledError(`Linear OAuth: ${err}`));
          return;
        }
        if (gotState !== state || !gotCode) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(htmlPage('Linear', '<h1>Invalid callback</h1><p>State or code missing.</p>'));
          finish(new Error('Linear OAuth callback was invalid'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          htmlPage(
            'Linear connected',
            '<h1>Linear connected</h1><p>You can close this tab and return to Sideboard.</p>',
          ),
        );
        finish(undefined, gotCode);
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    });

    const timer = setTimeout(() => {
      finish(new Error('Linear sign-in timed out — try again'));
    }, timeoutMs);

    const onAbort = () => finish(new LinearOAuthCancelledError());

    const cleanup = () => {
      clearTimeout(timer);
      opts?.signal?.removeEventListener('abort', onAbort);
      server.close();
    };

    opts?.signal?.addEventListener('abort', onAbort, { once: true });
    if (opts?.signal?.aborted) {
      onAbort();
      return;
    }

    server.on('error', (e) => {
      finish(
        e instanceof Error && (e as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? new Error(
              `Port ${LINEAR_OAUTH_PORT} is in use. Close whatever is bound there, or paste a Linear API key instead.`,
            )
          : e instanceof Error
            ? e
            : new Error(String(e)),
      );
    });

    server.listen(LINEAR_OAUTH_PORT, '127.0.0.1', () => {
      void Promise.resolve(opts?.openUrl?.(authorizeUrl)).catch((e) => {
        finish(e instanceof Error ? e : new Error(String(e)));
      });
    });
  });

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: LINEAR_OAUTH_REDIRECT,
    client_id: clientId,
    code_verifier: pkce.verifier,
  });
  if (clientSecret) body.set('client_secret', clientSecret);

  const data = await exchangeLinearToken(body);
  const viewer = await fetchLinearViewer(data.access_token!.trim()).catch(() => ({}));
  return persistLinearTokens(data, viewer);
}

async function revokeLinearToken(
  token: string,
  tokenTypeHint: 'access_token' | 'refresh_token',
): Promise<void> {
  const body = new URLSearchParams({
    token,
    token_type_hint: tokenTypeHint,
  });
  await fetch(LINEAR_REVOKE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }).catch(() => undefined);
}

/** Revoke OAuth tokens (best-effort) and clear Linear credentials including API key. */
export async function disconnectLinear(): Promise<AppSettings> {
  const settings = loadAppSettings();
  const access = settings.integrations.linearAccessToken?.trim();
  const refresh = settings.integrations.linearRefreshToken?.trim();
  if (access) await revokeLinearToken(access, 'access_token');
  if (refresh) await revokeLinearToken(refresh, 'refresh_token');
  return disconnectLinearConnection();
}
