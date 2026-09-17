import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { httpFetch } from '../http/fetch.js';
import {
  disconnectAbleTimeConnection,
  getAbleTimeHost,
  loadAppSettings,
  saveAbleTimeConnection,
  type AppSettings,
} from '../store/app-settings.js';
import { DEFAULT_ABLETIME_HOST, normalizeAbleTimeHost } from './abletime-mcp.js';

/** Hosted HTTPS return — AbleTime rejects loopback `http://` redirect_uris. */
export const ABLETIME_OAUTH_CALLBACK_PATH = '/oauth/abletime/callback';
export const ABLETIME_OAUTH_PORT = 19849;
/** Local listener the marketing-site bounce sends the browser to. */
export const ABLETIME_OAUTH_LOCAL_CALLBACK = `http://127.0.0.1:${ABLETIME_OAUTH_PORT}/callback`;
/** Registered redirect — must match `site/oauth/abletime-client.json` redirect_uris. */
export const ABLETIME_OAUTH_REDIRECT = `https://www.sideboard.cloud${ABLETIME_OAUTH_CALLBACK_PATH}`;

export function ableTimeOAuthRedirectUri(): string {
  return process.env.SIDEBOARD_ABLETIME_OAUTH_REDIRECT?.trim() || ABLETIME_OAUTH_REDIRECT;
}

const BOUNCE_QUERY_KEYS = ['code', 'state', 'error', 'error_description'] as const;

export function parseAbleTimeOAuthCallbackUrl(reqUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(reqUrl, ABLETIME_OAUTH_REDIRECT);
  } catch {
    return null;
  }
  if (url.pathname !== ABLETIME_OAUTH_CALLBACK_PATH) return null;
  return url;
}

/** Map the hosted callback onto the desktop listener (query: code / state / error). */
export function ableTimeOAuthLocalBounceUrl(reqUrl: string): string | null {
  const url = parseAbleTimeOAuthCallbackUrl(reqUrl);
  if (!url) return null;
  const dest = new URL(ABLETIME_OAUTH_LOCAL_CALLBACK);
  for (const key of BOUNCE_QUERY_KEYS) {
    const value = url.searchParams.get(key);
    if (value) dest.searchParams.set(key, value);
  }
  return dest.toString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Marketing-site page that immediately opens the desktop listener. */
export function ableTimeOAuthBouncePage(localUrl: string): string {
  const safe = escapeHtml(localUrl);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${safe}">
<title>Returning to Sideboard</title>
<script>location.replace(${JSON.stringify(localUrl)})</script>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;padding:48px 24px;max-width:36rem;margin:0 auto;color:#1a1a1a}
h1{font-size:1.25rem}p{line-height:1.5;color:#444}a{color:#0f7ed4}</style>
</head><body>
<h1>Returning to Sideboard</h1>
<p>AbleTime authorized. Opening the app…</p>
<p><a href="${safe}">Open Sideboard</a> if it does not appear.</p>
</body></html>`;
}

/** Client ID Metadata Document (AbleTime advertises CIMD, not DCR). */
export const BAKED_ABLETIME_OAUTH_CLIENT_ID =
  'https://www.sideboard.cloud/oauth/abletime-client.json';

export const ABLETIME_OAUTH_RESOURCE = `${DEFAULT_ABLETIME_HOST}/api/public/v2/mcp`;

const REFRESH_SKEW_MS = 5 * 60_000;

export function hasBakedAbleTimeOAuth(): boolean {
  return Boolean(BAKED_ABLETIME_OAUTH_CLIENT_ID.trim());
}

export function ableTimeOAuthClientId(): string {
  return (
    process.env.SIDEBOARD_ABLETIME_OAUTH_CLIENT_ID?.trim() ||
    BAKED_ABLETIME_OAUTH_CLIENT_ID.trim()
  );
}

export function ableTimeOAuthResource(host?: string | null): string {
  return `${normalizeAbleTimeHost(host)}/api/public/v2/mcp`;
}

export function createAbleTimePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function ableTimeOAuthAuthorizeUrl(
  clientId: string,
  state: string,
  codeChallenge: string,
  host?: string | null,
): string {
  const base = normalizeAbleTimeHost(host);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: ableTimeOAuthRedirectUri(),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    resource: ableTimeOAuthResource(host),
  });
  return `${base}/oauth/authorize?${params.toString()}`;
}

interface AbleTimeTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;padding:48px 24px;max-width:36rem;margin:0 auto;color:#1a1a1a}
h1{font-size:1.25rem}p{line-height:1.5;color:#444}</style></head><body>${body}</body></html>`;
}

async function exchangeAbleTimeToken(
  body: URLSearchParams,
  host?: string | null,
): Promise<AbleTimeTokenResponse> {
  const url = `${normalizeAbleTimeHost(host)}/api/oauth/token`;
  const res = await httpFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as AbleTimeTokenResponse;
  if (!res.ok || data.error || !data.access_token?.trim()) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`AbleTime OAuth token exchange failed: ${detail}`);
  }
  return data;
}

function persistAbleTimeTokens(
  data: AbleTimeTokenResponse,
  input?: { host?: string | null; viewerName?: string | null },
): AppSettings {
  return saveAbleTimeConnection({
    accessToken: data.access_token!.trim(),
    refreshToken: data.refresh_token?.trim(),
    expiresIn: data.expires_in,
    host: input?.host,
    viewerName: input?.viewerName,
  });
}

let refreshInFlight: Promise<string> | null = null;

async function refreshAbleTimeAccessToken(refreshToken: string): Promise<string> {
  const host = getAbleTimeHost();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: ableTimeOAuthClientId(),
    resource: ableTimeOAuthResource(host),
  });
  try {
    const data = await exchangeAbleTimeToken(body, host);
    persistAbleTimeTokens(data, { host });
    return data.access_token!.trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/invalid_grant|invalid_token|unauthorized/i.test(message)) {
      disconnectAbleTimeConnection();
      throw new Error('AbleTime sign-in expired — connect again in Account settings');
    }
    throw err;
  }
}

/** Current access token, refreshing when a refresh token is stored and near expiry. */
export async function ensureAbleTimeAccessToken(): Promise<string | null> {
  const settings = loadAppSettings();
  const access = settings.integrations.abletimeAccessToken?.trim() || '';
  const refresh = settings.integrations.abletimeRefreshToken?.trim() || '';
  const expiresAt = settings.integrations.abletimeTokenExpiresAt ?? 0;
  if (access && (!refresh || Date.now() < expiresAt - REFRESH_SKEW_MS)) {
    return access;
  }
  if (refresh) {
    if (!refreshInFlight) {
      refreshInFlight = refreshAbleTimeAccessToken(refresh).finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }
  return access || null;
}

export const ABLETIME_OAUTH_CANCELLED = 'AbleTime sign-in cancelled';

export class AbleTimeOAuthCancelledError extends Error {
  constructor(message = ABLETIME_OAUTH_CANCELLED) {
    super(message);
    this.name = 'AbleTimeOAuthCancelledError';
  }
}

export function isAbleTimeOAuthCancelled(err: unknown): boolean {
  if (err instanceof AbleTimeOAuthCancelledError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(ABLETIME_OAUTH_CANCELLED);
}

/**
 * Open AbleTime OAuth in the browser (MCP CIMD + PKCE). AbleTime redirects to
 * the HTTPS marketing-site callback; that page opens the desktop listener. Store
 * tokens, then run orientation for the viewer name.
 */
export async function startAbleTimeOAuth(opts?: {
  openUrl?: (url: string) => void | Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
  host?: string | null;
}): Promise<AppSettings> {
  if (opts?.signal?.aborted) {
    throw new AbleTimeOAuthCancelledError();
  }
  const clientId = ableTimeOAuthClientId();
  if (!clientId) {
    throw new Error(
      `AbleTime browser sign-in needs a Client ID Metadata Document URL. Host ${BAKED_ABLETIME_OAUTH_CLIENT_ID} (see site/oauth/abletime-client.json), or set SIDEBOARD_ABLETIME_OAUTH_CLIENT_ID.`,
    );
  }
  const host = opts?.host?.trim() || undefined;
  const state = randomBytes(16).toString('hex');
  const pkce = createAbleTimePkce();
  const authorizeUrl = ableTimeOAuthAuthorizeUrl(clientId, state, pkce.challenge, host);
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
        const url = new URL(req.url || '/', `http://127.0.0.1:${ABLETIME_OAUTH_PORT}`);
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
          res.end(htmlPage('AbleTime', `<h1>Authorization cancelled</h1><p>${err}</p>`));
          finish(new AbleTimeOAuthCancelledError(`AbleTime OAuth: ${err}`));
          return;
        }
        if (gotState !== state || !gotCode) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(htmlPage('AbleTime', '<h1>Invalid callback</h1><p>State or code missing.</p>'));
          finish(new Error('AbleTime OAuth callback was invalid'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          htmlPage(
            'AbleTime connected',
            '<h1>AbleTime connected</h1><p>You can close this tab and return to Sideboard.</p>',
          ),
        );
        finish(undefined, gotCode);
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    });

    const timer = setTimeout(() => {
      finish(new Error('AbleTime sign-in timed out — try again'));
    }, timeoutMs);

    const onAbort = () => finish(new AbleTimeOAuthCancelledError());

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
              `Port ${ABLETIME_OAUTH_PORT} is in use. Close whatever is bound there, or paste an AbleTime token instead.`,
            )
          : e instanceof Error
            ? e
            : new Error(String(e)),
      );
    });

    server.listen(ABLETIME_OAUTH_PORT, '127.0.0.1', () => {
      void Promise.resolve(opts?.openUrl?.(authorizeUrl)).catch((e) => {
        finish(e instanceof Error ? e : new Error(String(e)));
      });
    });
  });

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: ableTimeOAuthRedirectUri(),
    client_id: clientId,
    code_verifier: pkce.verifier,
    resource: ableTimeOAuthResource(host),
  });
  const data = await exchangeAbleTimeToken(body, host);
  persistAbleTimeTokens(data, { host });
  const token = data.access_token!.trim();
  try {
    const { getAbleTimeOrientation } = await import('./abletime.js');
    const orientation = await getAbleTimeOrientation({ token, host });
    return saveAbleTimeConnection({
      accessToken: token,
      refreshToken: data.refresh_token?.trim(),
      expiresIn: data.expires_in,
      host,
      viewerName: orientation.viewer.name,
    });
  } catch {
    return loadAppSettings();
  }
}
