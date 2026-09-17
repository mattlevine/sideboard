import { describe, expect, it } from 'vitest';
import {
  ABLETIME_OAUTH_REDIRECT,
  BAKED_ABLETIME_OAUTH_CLIENT_ID,
  ableTimeOAuthAuthorizeUrl,
  ableTimeOAuthClientId,
  createAbleTimePkce,
  hasBakedAbleTimeOAuth,
} from './abletime-oauth.js';

describe('abletime OAuth URL', () => {
  it('includes CIMD client_id, PKCE, resource, and localhost redirect', () => {
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
    expect(url).toContain(encodeURIComponent(ABLETIME_OAUTH_REDIRECT));
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
});
