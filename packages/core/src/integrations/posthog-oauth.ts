import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { httpFetch } from '../http/fetch.js';
import { loadAppSettings, savePosthogOAuth, type AppSettings } from '../store/app-settings.js';

/** CIMD document. PostHog fetches this URL; it has to be live before sign-in works. */
export const BAKED_POSTHOG_OAUTH_CLIENT_ID =
  'https://www.sideboard.build/oauth/posthog-client.json';

/** Portless loopback URI. PostHog matches any port on 127.0.0.1. */
export const POSTHOG_OAUTH_REGISTERED_REDIRECT = 'http://127.0.0.1/callback';

const POSTHOG_AUTHORIZE = 'https://oauth.posthog.com/oauth/authorize/';
const POSTHOG_TOKEN = 'https://oauth.posthog.com/oauth/token/';
const POSTHOG_API_HOSTS = ['https://us.posthog.com', 'https://eu.posthog.com'] as const;

/** Locked on the consent screen. Keep in sync with site/oauth/posthog-client.json. */
export const POSTHOG_OAUTH_SCOPES = [
  'project:read',
  'organization:read',
  'query:read',
  'insight:read',
  'feature_flag:read',
  'experiment:read',
  'error_tracking:read',
  'dashboard:read',
  'event_definition:read',
  'property_definition:read',
  'user:read',
  'person:read',
] as const;

/** The user can decline these. */
export const POSTHOG_OAUTH_OPTIONAL_SCOPES = [
  'query:write',
  'insight:write',
  'feature_flag:write',
  'experiment:write',
  'error_tracking:write',
  'dashboard:write',
  'person:write',
  'cohort:read',
  'cohort:write',
  'survey:read',
  'survey:write',
  'annotation:read',
  'annotation:write',
  'session_recording:read',
  'logs:read',
] as const;

const REFRESH_SKEW_MS = 60_000;

export class PosthogOAuthCancelledError extends Error {
  constructor(message = 'PostHog sign-in cancelled') {
    super(message);
    this.name = 'PosthogOAuthCancelledError';
  }
}

export function isPosthogOAuthCancelled(err: unknown): boolean {
  return err instanceof PosthogOAuthCancelledError;
}

export function posthogOAuthClientId(): string {
  return process.env.SIDEBOARD_POSTHOG_OAUTH_CLIENT_ID?.trim() || BAKED_POSTHOG_OAUTH_CLIENT_ID;
}

export function posthogOAuthScopeParam(): string {
  return [...POSTHOG_OAUTH_SCOPES, ...POSTHOG_OAUTH_OPTIONAL_SCOPES].join(' ');
}

export function createPosthogPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function posthogOAuthAuthorizeUrl(
  clientId: string,
  state: string,
  codeChallenge: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: posthogOAuthScopeParam(),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${POSTHOG_AUTHORIZE}?${params.toString()}`;
}

type PosthogTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;padding:48px 24px;max-width:36rem;margin:0 auto;color:#1a1a1a}
h1{font-size:1.25rem}p{line-height:1.5;color:#444}</style></head><body>${body}</body></html>`;
}

async function exchangePosthogToken(body: URLSearchParams): Promise<PosthogTokenResponse> {
  const res = await httpFetch(POSTHOG_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as PosthogTokenResponse;
  if (!res.ok || data.error || !data.access_token?.trim()) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`PostHog sign-in failed: ${detail}`);
  }
  return data;
}

function viewerNameFromMe(body: unknown): string {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const email = typeof record.email === 'string' ? record.email.trim() : '';
  if (email) return email.slice(0, 120);
  const first = typeof record.first_name === 'string' ? record.first_name.trim() : '';
  const last = typeof record.last_name === 'string' ? record.last_name.trim() : '';
  const name = [first, last].filter(Boolean).join(' ');
  return (name || 'PostHog user').slice(0, 120);
}

/** US Cloud, then EU Cloud. OAuth tokens are region-agnostic; the API host is not. */
export async function discoverPosthogHost(
  token: string,
): Promise<{ host: string; viewerName: string }> {
  let last = 'PostHog rejected the sign-in';
  for (const host of POSTHOG_API_HOSTS) {
    const res = await httpFetch(`${host}/api/users/@me/`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 401 || res.status === 403) {
      last = `${host} rejected the token`;
      continue;
    }
    if (!res.ok) {
      last = `${host} returned HTTP ${res.status}`;
      continue;
    }
    const body = await res.json().catch(() => ({}));
    return { host, viewerName: viewerNameFromMe(body) };
  }
  throw new Error(last);
}

/**
 * Vaulted OAuth access token, refreshed when it is near expiry.
 * A previously stored personal API key still works until the user signs in.
 */
export async function getPosthogAccessToken(): Promise<{ token: string; host: string } | null> {
  const integrations = loadAppSettings().integrations;
  const host = integrations.posthogHost?.trim() || 'https://us.posthog.com';
  const access = integrations.posthogAccessToken?.trim() || '';
  const refresh = integrations.posthogRefreshToken?.trim() || '';
  const legacy = integrations.posthogPersonalApiKey?.trim() || '';
  const exp = integrations.posthogTokenExpiresAt;
  const accessFresh = Boolean(access) && (exp == null || exp - Date.now() > REFRESH_SKEW_MS);
  if (accessFresh) return { token: access, host };
  if (refresh) {
    try {
      const data = await exchangePosthogToken(
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refresh,
          client_id: posthogOAuthClientId(),
        }),
      );
      const saved = savePosthogOAuth({
        accessToken: data.access_token!.trim(),
        refreshToken: data.refresh_token?.trim() || refresh,
        expiresIn: data.expires_in,
        host,
        viewerName: integrations.posthogViewerName,
      });
      return {
        token: saved.integrations.posthogAccessToken!.trim(),
        host: saved.integrations.posthogHost?.trim() || host,
      };
    } catch (err) {
      if (legacy) return { token: legacy, host };
      throw err;
    }
  }
  if (access) return { token: access, host };
  if (legacy) return { token: legacy, host };
  return null;
}

/**
 * Open PostHog OAuth in the browser (CIMD + PKCE). Listens on a free loopback
 * port; the registered redirect is portless `http://127.0.0.1/callback`.
 */
export async function startPosthogOAuth(opts?: {
  openUrl?: (url: string) => void | Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AppSettings> {
  if (opts?.signal?.aborted) throw new PosthogOAuthCancelledError();
  const clientId = posthogOAuthClientId();
  const state = randomBytes(16).toString('hex');
  const pkce = createPosthogPkce();
  const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;

  const code = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error, value?: { code: string; redirectUri: string }) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(value!);
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const err = url.searchParams.get('error');
        const gotState = url.searchParams.get('state');
        const gotCode = url.searchParams.get('code');
        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(htmlPage('PostHog', '<h1>Authorization cancelled</h1><p>You can close this tab.</p>'));
          finish(new PosthogOAuthCancelledError());
          return;
        }
        if (gotState !== state || !gotCode) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(htmlPage('PostHog', '<h1>Invalid callback</h1><p>State or code missing.</p>'));
          finish(new Error('PostHog sign-in callback was invalid'));
          return;
        }
        const addr = server.address();
        const port = addr && typeof addr !== 'string' ? addr.port : 0;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          htmlPage(
            'PostHog connected',
            '<h1>PostHog connected</h1><p>You can close this tab and return to Sideboard.</p>',
          ),
        );
        finish(undefined, { code: gotCode, redirectUri: `http://127.0.0.1:${port}/callback` });
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    });

    const timer = setTimeout(() => finish(new Error('PostHog sign-in timed out — try again')), timeoutMs);
    const onAbort = () => finish(new PosthogOAuthCancelledError());
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
      finish(e instanceof Error ? e : new Error(String(e)));
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr !== 'string' ? addr.port : 0;
      if (!port) {
        finish(new Error('PostHog sign-in could not bind a local port'));
        return;
      }
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const authorizeUrl = posthogOAuthAuthorizeUrl(clientId, state, pkce.challenge, redirectUri);
      void Promise.resolve(opts?.openUrl?.(authorizeUrl)).catch((e) => {
        finish(e instanceof Error ? e : new Error(String(e)));
      });
    });
  });

  const data = await exchangePosthogToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: code.code,
      redirect_uri: code.redirectUri,
      client_id: clientId,
      code_verifier: pkce.verifier,
    }),
  );
  const token = data.access_token!.trim();
  const discovered = await discoverPosthogHost(token);
  return savePosthogOAuth({
    accessToken: token,
    refreshToken: data.refresh_token?.trim(),
    expiresIn: data.expires_in,
    host: discovered.host,
    viewerName: discovered.viewerName,
  });
}
