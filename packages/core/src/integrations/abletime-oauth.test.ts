import { describe, expect, it } from 'vitest';
import {
  ABLETIME_OAUTH_CALLBACK_PATH,
  ABLETIME_OAUTH_LOCAL_CALLBACK,
  ABLETIME_OAUTH_REDIRECT,
  BAKED_ABLETIME_OAUTH_CLIENT_ID,
  ableTimeOAuthAuthorizeUrl,
  ableTimeOAuthBouncePage,
  ableTimeOAuthClientId,
  ableTimeOAuthLocalBounceUrl,
  ableTimeOAuthRedirectUri,
  createAbleTimePkce,
  hasBakedAbleTimeOAuth,
  parseAbleTimeOAuthCallbackUrl,
  resolveAbleTimeOAuthHost,
} from './abletime-oauth.js';

describe('abletime OAuth URL', () => {
  it('includes CIMD client_id, PKCE, resource, and the HTTPS site redirect', () => {
    const url = ableTimeOAuthAuthorizeUrl(
      BAKED_ABLETIME_OAUTH_CLIENT_ID,
      'state123',
      'challengeABC',
    );
    expect(url).toContain('https://track.abletime.com/oauth/authorize?');
    expect(url).toContain(`client_id=${encodeURIComponent(BAKED_ABLETIME_OAUTH_CLIENT_ID)}`);
    expect(url).toContain('state=state123');
    expect(url).toContain('code_challenge=challengeABC');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain(
      encodeURIComponent('https://track.abletime.com/api/public/v2/mcp'),
    );
    expect(ABLETIME_OAUTH_REDIRECT).toBe('https://www.sideboard.cloud/oauth/abletime/callback');
    expect(ABLETIME_OAUTH_REDIRECT.startsWith('https://')).toBe(true);
    expect(url).toContain(encodeURIComponent(ABLETIME_OAUTH_REDIRECT));
  });

  it('points authorize + resource at a custom host', () => {
    const url = ableTimeOAuthAuthorizeUrl(
      BAKED_ABLETIME_OAUTH_CLIENT_ID,
      'state123',
      'challengeABC',
      'https://crm.example.com',
    );
    expect(url).toContain('https://crm.example.com/oauth/authorize?');
    expect(url).toContain(encodeURIComponent('https://crm.example.com/api/public/v2/mcp'));
    expect(resolveAbleTimeOAuthHost('https://crm.example.com', 'https://track.abletime.com')).toBe(
      'https://crm.example.com',
    );
    expect(resolveAbleTimeOAuthHost('', 'https://crm.example.com')).toBe('https://crm.example.com');
    expect(resolveAbleTimeOAuthHost(null, null)).toBeUndefined();
  });

  it('PKCE verifier is base64url and challenge is SHA-256 of it', () => {
    const { verifier, challenge } = createAbleTimePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toBe(verifier);
  });

  it('uses the hosted Client ID Metadata Document by default', () => {
    expect(hasBakedAbleTimeOAuth()).toBe(true);
    expect(ableTimeOAuthClientId()).toBe(BAKED_ABLETIME_OAUTH_CLIENT_ID);
    expect(BAKED_ABLETIME_OAUTH_CLIENT_ID).toBe(
      'https://www.sideboard.cloud/oauth/abletime-client.json',
    );
  });

  it('bounces the hosted HTTPS callback onto the local listener', () => {
    expect(ABLETIME_OAUTH_CALLBACK_PATH).toBe('/oauth/abletime/callback');
    expect(ABLETIME_OAUTH_LOCAL_CALLBACK).toBe('http://127.0.0.1:19849/callback');
    const bounced = ableTimeOAuthLocalBounceUrl(
      '/oauth/abletime/callback?code=abc&state=xyz&extra=drop',
    );
    expect(bounced).toBe('http://127.0.0.1:19849/callback?code=abc&state=xyz');
    expect(parseAbleTimeOAuthCallbackUrl('/oauth/abletime/callback?code=abc')).not.toBeNull();
    expect(ableTimeOAuthLocalBounceUrl('/slack/callback?code=abc&state=xyz')).toBeNull();
    expect(ableTimeOAuthLocalBounceUrl('/callback?code=abc')).toBeNull();
    const page = ableTimeOAuthBouncePage('http://127.0.0.1:19849/callback?code=abc&state=xyz');
    expect(page).toContain('http://127.0.0.1:19849/callback?code=abc&amp;state=xyz');
    expect(page).toContain('location.replace("http://127.0.0.1:19849/callback?code=abc&state=xyz")');
  });

  it('SIDEBOARD_ABLETIME_OAUTH_REDIRECT overrides the registered URI', () => {
    const prev = process.env.SIDEBOARD_ABLETIME_OAUTH_REDIRECT;
    process.env.SIDEBOARD_ABLETIME_OAUTH_REDIRECT = 'https://example.test/oauth/abletime/callback';
    try {
      expect(ableTimeOAuthRedirectUri()).toBe('https://example.test/oauth/abletime/callback');
    } finally {
      if (prev === undefined) delete process.env.SIDEBOARD_ABLETIME_OAUTH_REDIRECT;
      else process.env.SIDEBOARD_ABLETIME_OAUTH_REDIRECT = prev;
    }
  });
});
