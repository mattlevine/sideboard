import { formatFetchError } from '../http/fetch.js';
import {
  loadBrightsyConfig,
  saveBrightsyConfig,
  type BrightsyLocalConfig,
} from './config.js';

const REFRESH_SKEW_MS = 60_000;

export type BrightsyTokenGrant = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
};

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
 * Exchange a refresh token at `{endpoint}/oauth/token`.
 * Returns null when the server rejects the grant (caller keeps the old session).
 */
export async function refreshBrightsyAccessToken(opts: {
  endpoint: string;
  refreshToken: string;
  clientId?: string;
  fetchImpl?: typeof fetch;
}): Promise<BrightsyTokenGrant | null> {
  const endpoint = (opts.endpoint || 'https://brightsy.ai').replace(/\/$/, '');
  const url = `${endpoint}/oauth/token`;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: opts.refreshToken,
        client_id: opts.clientId || 'brightsy-cli',
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

/** Refresh ~/.brightsy when a refresh token exists and the access token is stale. */
export async function ensureBrightsyLocalConfigFresh(opts?: {
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
  const grant = await refreshBrightsyAccessToken({
    endpoint: cfg.endpoint || 'https://brightsy.ai',
    refreshToken: cfg.refresh_token,
    clientId: cfg.oauth_client_id,
    fetchImpl: opts?.fetchImpl,
  });
  if (!grant) return cfg;
  const next = { ...cfg, ...applyGrant(cfg, grant) };
  saveBrightsyConfig(next);
  return next;
}
