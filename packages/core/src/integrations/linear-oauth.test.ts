import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLinearPkce,
  linearAuthorizationHeader,
  linearOAuthAuthorizeUrl,
  LINEAR_OAUTH_REDIRECT,
  startLinearOAuth,
} from './linear-oauth.js';
import { BAKED_LINEAR_CLIENT_ID, hasBakedLinearOAuth } from './linear-app.js';

describe('linear OAuth URL', () => {
  it('includes client_id, PKCE, read+write scope, and localhost redirect', () => {
    const url = linearOAuthAuthorizeUrl('CLIENT', 'state123', 'challengeABC');
    expect(url).toContain('https://linear.app/oauth/authorize?');
    expect(url).toContain('client_id=CLIENT');
    expect(url).toContain('state=state123');
    expect(url).toContain('code_challenge=challengeABC');
    expect(url).toContain('code_challenge_method=S256');
    expect(new URL(url).searchParams.get('scope')).toBe('read,write');
    expect(url).toContain('prompt=consent');
    expect(url).toContain(encodeURIComponent(LINEAR_OAUTH_REDIRECT));
  });

  it('PKCE verifier is base64url and challenge is SHA-256 of it', () => {
    const { verifier, challenge } = createLinearPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toBe(verifier);
  });
});

describe('linearAuthorizationHeader', () => {
  it('passes personal API keys through and Bearers OAuth tokens', () => {
    expect(linearAuthorizationHeader('lin_api_abc')).toBe('lin_api_abc');
    expect(linearAuthorizationHeader('00a21d8b0c4e2375')).toBe('Bearer 00a21d8b0c4e2375');
    expect(linearAuthorizationHeader('Bearer already')).toBe('Bearer already');
  });
});

describe('linear OAuth credentials', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  const prevId = process.env.SIDEBOARD_LINEAR_CLIENT_ID;
  const prevSecret = process.env.SIDEBOARD_LINEAR_CLIENT_SECRET;

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    if (prevId === undefined) delete process.env.SIDEBOARD_LINEAR_CLIENT_ID;
    else process.env.SIDEBOARD_LINEAR_CLIENT_ID = prevId;
    if (prevSecret === undefined) delete process.env.SIDEBOARD_LINEAR_CLIENT_SECRET;
    else process.env.SIDEBOARD_LINEAR_CLIENT_SECRET = prevSecret;
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('Connect via browser uses baked Client ID when env is empty', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-linear-oauth-'));
    delete process.env.SIDEBOARD_LINEAR_CLIENT_ID;
    delete process.env.SIDEBOARD_LINEAR_CLIENT_SECRET;
    expect(hasBakedLinearOAuth()).toBe(true);
    const { linearOAuthCredentials } = await import('./linear-oauth.js');
    const creds = linearOAuthCredentials();
    expect(creds.clientId).toBe(BAKED_LINEAR_CLIENT_ID);
    expect(creds.clientSecret).toBe('');
  });

  it('SIDEBOARD_LINEAR_CLIENT_ID overrides the baked id', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-linear-oauth-'));
    process.env.SIDEBOARD_LINEAR_CLIENT_ID = 'env-client';
    process.env.SIDEBOARD_LINEAR_CLIENT_SECRET = 'env-secret';
    const { linearOAuthCredentials } = await import('./linear-oauth.js');
    const creds = linearOAuthCredentials();
    expect(creds.clientId).toBe('env-client');
    expect(creds.clientSecret).toBe('env-secret');
  });

  it('getLinearAuthToken returns a stored access token and refreshes when expired', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-linear-oauth-'));
    process.env.SIDEBOARD_LINEAR_CLIENT_ID = 'env-client';
    delete process.env.SIDEBOARD_LINEAR_CLIENT_SECRET;
    const settings = await import('../store/app-settings.js');
    settings.saveLinearOAuth({
      accessToken: 'old-access',
      refreshToken: 'refresh-1',
      expiresIn: 3600,
    });
    const { getLinearAuthToken } = await import('./linear-oauth.js');
    expect(await getLinearAuthToken()).toBe('old-access');

    settings.saveLinearOAuth({
      accessToken: 'old-access',
      refreshToken: 'refresh-1',
      expiresIn: 0,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'refresh-2',
        expires_in: 86399,
        token_type: 'Bearer',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await getLinearAuthToken()).toBe('new-access');
    expect(fetchMock).toHaveBeenCalled();
    const body = String(fetchMock.mock.calls[0]?.[1]?.body ?? '');
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=refresh-1');
    expect(settings.loadAppSettings().integrations.linearAccessToken).toBe('new-access');
    expect(settings.loadAppSettings().integrations.linearRefreshToken).toBe('refresh-2');
    vi.unstubAllGlobals();
  });

  it('surfaces undici fetch-failed cause on token refresh', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-linear-oauth-fetch-'));
    process.env.SIDEBOARD_LINEAR_CLIENT_ID = 'env-client';
    delete process.env.SIDEBOARD_LINEAR_CLIENT_SECRET;
    const settings = await import('../store/app-settings.js');
    settings.saveLinearOAuth({
      accessToken: 'old-access',
      refreshToken: 'refresh-1',
      expiresIn: 0,
    });
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.linear.app'), {
      code: 'ENOTFOUND',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause })),
    );
    const { getLinearAuthToken } = await import('./linear-oauth.js');
    await expect(getLinearAuthToken()).rejects.toThrow(
      /fetch failed \[ENOTFOUND: getaddrinfo ENOTFOUND api.linear.app\] \(https:\/\/api\.linear\.app\/oauth\/token\)/,
    );
    vi.unstubAllGlobals();
  });

  it('AbortSignal cancels a waiting Linear sign-in', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-linear-oauth-cancel-'));
    delete process.env.SIDEBOARD_LINEAR_CLIENT_ID;
    delete process.env.SIDEBOARD_LINEAR_CLIENT_SECRET;
    const ac = new AbortController();
    const pending = startLinearOAuth({
      openUrl: () => {
        ac.abort();
      },
      timeoutMs: 5_000,
      signal: ac.signal,
    });
    await expect(pending).rejects.toMatchObject({ name: 'LinearOAuthCancelledError' });
  });

  it('already-aborted signal does not wait for Linear', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-linear-oauth-aborted-'));
    const ac = new AbortController();
    ac.abort();
    await expect(
      startLinearOAuth({
        openUrl: () => {
          throw new Error('should not open the browser');
        },
        signal: ac.signal,
      }),
    ).rejects.toMatchObject({ name: 'LinearOAuthCancelledError' });
  });
});
