import { formatFetchError } from '../http/fetch.js';
import {
  loadBrightsyConfig,
  saveBrightsyConfig,
  type BrightsyLocalConfig,
} from './config.js';

const REFRESH_SKEW_MS = 60_000;

/** Public OAuth 2.1 client id Sideboard registers via RFC 7591 DCR. */
export const BRIGHTSY_OAUTH_CLIENT_ID = 'sideboard';

/** Loopback redirect reserved for Sideboard Brightsy OAuth (DCR metadata). */
export const BRIGHTSY_OAUTH_REDIRECT = 'http://127.0.0.1:19850/callback';

export type BrightsyTokenGrant = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
};

export type BrightsyOAuthClientRegistration = {
  client_id: string;
  client_secret?: string;
};

function defaultFetch(fetchImpl?: typeof fetch): typeof fetch {
  return fetchImpl ?? globalThis.fetch.bind(globalThis);
}

export function normalizeBrightsyEndpoint(endpoint?: string): string {
  return (endpoint || 'https://brightsy.ai').replace(/\/$/, '');
}

/** True when the access token is expired, unknown, or within 60s of expiry. */
export function brightsyAccessTokenNeedsRefresh(
  expiresAt?: number,
  now = Date.now(),
): boolean {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    return true;
  }
  return now >= expiresAt - REFRESH_SKEW_MS;
}

function applyGrant(
  current: { access_token: string; refresh_token?: string; expires_at?: number },
  grant: BrightsyTokenGrant,
): { access_token: string; refresh_token?: string; expires_at?: number } {
  return {
    access_token: grant.access_token,
    refresh_token: grant.refresh_token || current.refresh_token,
    expires_at: grant.expires_at ?? current.expires_at,
  };
}

/**
 * OAuth 2.1 Dynamic Client Registration (RFC 7591) at `{endpoint}/oauth/register`.
 * Requests a stable public client (`sideboard`) so refresh_token grants keep
 * working after the access token expires — no browser reconnect.
 */
export async function registerBrightsyOAuthClient(opts: {
  endpoint: string;
  clientId?: string;
  redirectUri?: string;
  fetchImpl?: typeof fetch;
}): Promise<BrightsyOAuthClientRegistration | null> {
  const endpoint = normalizeBrightsyEndpoint(opts.endpoint);
  const url = `${endpoint}/oauth/register`;
  const clientId = (opts.clientId || BRIGHTSY_OAUTH_CLIENT_ID).trim();
  const redirectUri = opts.redirectUri || BRIGHTSY_OAUTH_REDIRECT;
  const fetchImpl = defaultFetch(opts.fetchImpl);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_name: 'Sideboard',
        description: 'Sideboard desktop Brightsy MCP client',
        redirect_uris: [redirectUri],
        scope: 'brightsy:api',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
  } catch (err) {
    throw new Error(formatFetchError(err, url));
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { client_id?: string; client_secret?: string };
  if (!data.client_id?.trim()) return null;
  return {
    client_id: data.client_id.trim(),
    client_secret: data.client_secret?.trim() || undefined,
  };
}

/**
 * Resolve the public client id for token grants: stored DCR id, else register.
 * Falls back to {@link BRIGHTSY_OAUTH_CLIENT_ID} when registration is unavailable.
 */
export async function ensureBrightsyOAuthClientId(opts: {
  endpoint: string;
  clientId?: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const existing = opts.clientId?.trim();
  if (existing) return existing;
  const registered = await registerBrightsyOAuthClient({
    endpoint: opts.endpoint,
    fetchImpl: opts.fetchImpl,
  });
  return registered?.client_id || BRIGHTSY_OAUTH_CLIENT_ID;
}

/**
 * Exchange a refresh token at `{endpoint}/oauth/token`.
 * Returns null when the server rejects the grant (caller keeps the old session).
 */
export async function refreshBrightsyAccessToken(opts: {
  endpoint: string;
  refreshToken: string;
  clientId?: string;
  fetchImpl?: typeof fetch;
}): Promise<BrightsyTokenGrant | null> {
  const endpoint = normalizeBrightsyEndpoint(opts.endpoint);
  const url = `${endpoint}/oauth/token`;
  const fetchImpl = defaultFetch(opts.fetchImpl);
  const clientId = opts.clientId?.trim() || BRIGHTSY_OAUTH_CLIENT_ID;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: opts.refreshToken,
        client_id: clientId,
      }),
    });
  } catch (err) {
    throw new Error(formatFetchError(err, url));
  }
  if (!res.ok) return null;
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
  };
}

let refreshInFlight: Promise<BrightsyLocalConfig | null> | null = null;

async function ensureBrightsyLocalConfigFreshOnce(opts?: {
  fetchImpl?: typeof fetch;
}): Promise<BrightsyLocalConfig | null> {
  let cfg: BrightsyLocalConfig;
  try {
    cfg = loadBrightsyConfig();
  } catch {
    return null;
  }

  if (!cfg.refresh_token || !brightsyAccessTokenNeedsRefresh(cfg.expires_at)) {
    return cfg;
  }

  const endpoint = normalizeBrightsyEndpoint(cfg.endpoint);
  const clientId = await ensureBrightsyOAuthClientId({
    endpoint,
    clientId: cfg.oauth_client_id,
    fetchImpl: opts?.fetchImpl,
  });
  if (clientId !== cfg.oauth_client_id) {
    cfg = { ...cfg, oauth_client_id: clientId };
    saveBrightsyConfig(cfg);
  }

  const grant = await refreshBrightsyAccessToken({
    endpoint,
    refreshToken: cfg.refresh_token,
    clientId,
    fetchImpl: opts?.fetchImpl,
  });
  if (!grant) return cfg;
  const next = { ...cfg, ...applyGrant(cfg, grant), oauth_client_id: clientId };
  saveBrightsyConfig(next);
  return next;
}

/** Refresh ~/.brightsy when a refresh token exists and the access token is stale. */
export async function ensureBrightsyLocalConfigFresh(opts?: {
  fetchImpl?: typeof fetch;
}): Promise<BrightsyLocalConfig | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = ensureBrightsyLocalConfigFreshOnce(opts).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}
