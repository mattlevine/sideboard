import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BAKED_POSTHOG_OAUTH_CLIENT_ID,
  POSTHOG_OAUTH_OPTIONAL_SCOPES,
  POSTHOG_OAUTH_SCOPES,
  createPosthogPkce,
  posthogOAuthAuthorizeUrl,
  posthogOAuthScopeParam,
} from './posthog-oauth.js';

describe('posthog oauth', () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = prevHome;
    delete process.env.SIDEBOARD_POSTHOG_OAUTH_CLIENT_ID;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('publishes a CIMD document PostHog can fetch', () => {
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../site/oauth/posthog-client.json',
    );
    const raw = readFileSync(path, 'utf8');
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(5 * 1024);
    const doc = JSON.parse(raw) as {
      client_id: string;
      client_name: string;
      redirect_uris: string[];
      token_endpoint_auth_method: string;
      'com.posthog': { scopes: string[]; optional_scopes: string[] };
    };
    expect(doc.client_id).toBe(BAKED_POSTHOG_OAUTH_CLIENT_ID);
    expect(doc.client_name.toLowerCase()).not.toMatch(/post\s*hog|official|verified|trusted/);
    expect(doc.redirect_uris).toEqual(['http://127.0.0.1/callback']);
    expect(doc.token_endpoint_auth_method).toBe('none');
    expect(doc['com.posthog'].scopes).toEqual([...POSTHOG_OAUTH_SCOPES]);
    expect(doc['com.posthog'].optional_scopes).toEqual([...POSTHOG_OAUTH_OPTIONAL_SCOPES]);
  });

  it('builds a PKCE authorize URL against the region-agnostic host', () => {
    const pkce = createPosthogPkce();
    const url = new URL(
      posthogOAuthAuthorizeUrl(
        BAKED_POSTHOG_OAUTH_CLIENT_ID,
        'state1',
        pkce.challenge,
        'http://127.0.0.1:54321/callback',
      ),
    );
    expect(url.origin + url.pathname).toBe('https://oauth.posthog.com/oauth/authorize/');
    expect(url.searchParams.get('client_id')).toBe(BAKED_POSTHOG_OAUTH_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:54321/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(pkce.challenge);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe(posthogOAuthScopeParam());
    expect(url.searchParams.get('scope')).toContain('query:read');
    expect(url.searchParams.get('scope')).toContain('insight:write');
  });

  it('uses the EU API when US rejects the token', async () => {
    const [oauth, fetchMod] = await Promise.all([
      import('./posthog-oauth.js'),
      import('../http/fetch.js'),
    ]);
    fetchMod.setHttpFetchImpl(
      vi.fn(async (url: string) => {
        if (String(url).startsWith('https://us.posthog.com')) {
          return new Response('no', { status: 401 });
        }
        return new Response(JSON.stringify({ email: 'matt@acme' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch,
    );
    await expect(oauth.discoverPosthogHost('pha_test')).resolves.toEqual({
      host: 'https://eu.posthog.com',
      viewerName: 'matt@acme',
    });
  });

  it('refreshes an expired access token and keeps the stored host', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-posthog-oauth-'));
    process.env.HOME = home;
    vi.resetModules();
    const [oauth, settings, fetchMod] = await Promise.all([
      import('./posthog-oauth.js'),
      import('../store/app-settings.js'),
      import('../http/fetch.js'),
    ]);
    settings.savePosthogOAuth({
      accessToken: 'pha_old',
      refreshToken: 'phr_old',
      expiresIn: 0,
      host: 'https://eu.posthog.com',
      viewerName: 'matt@acme',
    });
    fetchMod.setHttpFetchImpl(
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(String(url)).toBe('https://oauth.posthog.com/oauth/token/');
        const body = String(init?.body);
        expect(body).toContain('grant_type=refresh_token');
        expect(body).toContain('refresh_token=phr_old');
        expect(body).toContain(encodeURIComponent(BAKED_POSTHOG_OAUTH_CLIENT_ID));
        return new Response(
          JSON.stringify({ access_token: 'pha_new', refresh_token: 'phr_new', expires_in: 3600 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch,
    );
    await expect(oauth.getPosthogAccessToken()).resolves.toEqual({
      token: 'pha_new',
      host: 'https://eu.posthog.com',
    });
    expect(settings.loadAppSettings().integrations.posthogRefreshToken).toBe('phr_new');
    expect(settings.loadAppSettings().integrations.posthogPersonalApiKey).toBeUndefined();
    const pub = settings.toPublicAppSettings(settings.loadAppSettings()).integrations;
    expect(pub.hasPosthogToken).toBe(true);
    expect('posthogAccessToken' in pub).toBe(false);
  });

  it('keeps a legacy personal API key when OAuth is absent', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-posthog-oauth-'));
    process.env.HOME = home;
    vi.resetModules();
    const [oauth, settings] = await Promise.all([
      import('./posthog-oauth.js'),
      import('../store/app-settings.js'),
    ]);
    settings.updateIntegrationsSettings({
      posthogPersonalApiKey: 'phx_test',
      posthogHost: 'https://eu.posthog.com',
    });
    await expect(oauth.getPosthogAccessToken()).resolves.toEqual({
      token: 'phx_test',
      host: 'https://eu.posthog.com',
    });
    expect(settings.isPosthogConnected()).toBe(true);
  });
});
