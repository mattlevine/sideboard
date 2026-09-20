import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRIGHTSY_OAUTH_CLIENT_ID,
  BRIGHTSY_OAUTH_REDIRECT,
  brightsyAccessTokenNeedsRefresh,
  ensureBrightsyLocalConfigFresh,
  ensureBrightsyOAuthClientId,
  refreshBrightsyAccessToken,
  registerBrightsyOAuthClient,
} from './oauth.js';

describe('brightsyAccessTokenNeedsRefresh', () => {
  it('refreshes when expiry is missing or invalid', () => {
    expect(brightsyAccessTokenNeedsRefresh(undefined)).toBe(true);
    expect(brightsyAccessTokenNeedsRefresh(0)).toBe(true);
    expect(brightsyAccessTokenNeedsRefresh(Number.NaN)).toBe(true);
  });

  it('refreshes within 60s of expiry', () => {
    const now = 1_000_000;
    expect(brightsyAccessTokenNeedsRefresh(now + 30_000, now)).toBe(true);
    expect(brightsyAccessTokenNeedsRefresh(now + 120_000, now)).toBe(false);
  });
});

describe('refreshBrightsyAccessToken', () => {
  it('posts the refresh grant and returns the new tokens', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }),
    });
    const grant = await refreshBrightsyAccessToken({
      endpoint: 'https://brightsy.ai/',
      refreshToken: 'old-refresh',
      clientId: 'brightsy-cli',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(grant?.access_token).toBe('new-access');
    expect(grant?.refresh_token).toBe('new-refresh');
    expect(grant?.expires_at).toBeGreaterThan(Date.now());
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('grant_type=refresh_token');
    expect(String(init.body)).toContain('refresh_token=old-refresh');
    expect(String(init.body)).toContain('client_id=brightsy-cli');
  });

  it('defaults to the Sideboard DCR client id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access', expires_in: 60 }),
    });
    await refreshBrightsyAccessToken({
      endpoint: 'https://brightsy.ai',
      refreshToken: 'old-refresh',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain(`client_id=${BRIGHTSY_OAUTH_CLIENT_ID}`);
  });

  it('returns null when the server rejects the grant', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(
      refreshBrightsyAccessToken({
        endpoint: 'https://brightsy.ai',
        refreshToken: 'dead',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toBeNull();
  });
});

describe('ensureBrightsyLocalConfigFresh', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sb-brightsy-home-'));
    mkdirSync(join(home, '.brightsy'), { recursive: true });
    vi.stubEnv('BRIGHTSY_CONFIG', join(home, '.brightsy', 'config.json'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('refreshes ~/.brightsy when expires_at is missing', async () => {
    writeFileSync(
      process.env.BRIGHTSY_CONFIG!,
      JSON.stringify({
        access_token: 'stale',
        refresh_token: 'r1',
        account_id: 'acct',
        endpoint: 'https://brightsy.ai',
      }),
    );
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'fresh',
        refresh_token: 'r2',
        expires_in: 3600,
      }),
    });
    const next = await ensureBrightsyLocalConfigFresh({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(next?.access_token).toBe('fresh');
    expect(next?.refresh_token).toBe('r2');
    const saved = JSON.parse(readFileSync(process.env.BRIGHTSY_CONFIG!, 'utf8')) as {
      access_token: string;
    };
    expect(saved.access_token).toBe('fresh');
  });

  it('skips the network when the access token is still fresh', async () => {
    writeFileSync(
      process.env.BRIGHTSY_CONFIG!,
      JSON.stringify({
        access_token: 'ok',
        refresh_token: 'r1',
        account_id: 'acct',
        expires_at: Date.now() + 10 * 60_000,
      }),
    );
    const fetchImpl = vi.fn();
    const next = await ensureBrightsyLocalConfigFresh({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(next?.access_token).toBe('ok');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('registers a public client via DCR then refreshes with that id', async () => {
    writeFileSync(
      process.env.BRIGHTSY_CONFIG!,
      JSON.stringify({
        access_token: 'stale',
        refresh_token: 'r1',
        account_id: 'acct',
        endpoint: 'https://brightsy.ai',
      }),
    );
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).endsWith('/oauth/register')) {
        return {
          ok: true,
          json: async () => ({ client_id: 'sideboard-dcr' }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          access_token: 'fresh',
          refresh_token: 'r2',
          expires_in: 3600,
        }),
      };
    });
    const next = await ensureBrightsyLocalConfigFresh({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(next?.oauth_client_id).toBe('sideboard-dcr');
    expect(next?.access_token).toBe('fresh');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [registerUrl, registerInit] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(registerUrl).toBe('https://brightsy.ai/oauth/register');
    const registered = JSON.parse(String(registerInit.body)) as {
      client_id: string;
      grant_types: string[];
      token_endpoint_auth_method: string;
      redirect_uris: string[];
    };
    expect(registered.client_id).toBe(BRIGHTSY_OAUTH_CLIENT_ID);
    expect(registered.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(registered.token_endpoint_auth_method).toBe('none');
    expect(registered.redirect_uris).toEqual([BRIGHTSY_OAUTH_REDIRECT]);
    const [, tokenInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(String(tokenInit.body)).toContain('client_id=sideboard-dcr');
  });
});

describe('registerBrightsyOAuthClient', () => {
  it('posts RFC 7591 metadata and returns the issued client_id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ client_id: 'sideboard' }),
    });
    const reg = await registerBrightsyOAuthClient({
      endpoint: 'https://brightsy.ai/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(reg?.client_id).toBe('sideboard');
    expect(await ensureBrightsyOAuthClientId({
      endpoint: 'https://brightsy.ai',
      clientId: 'already-there',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).toBe('already-there');
  });
});
