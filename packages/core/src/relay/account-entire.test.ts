import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ENTIRE_DEFAULT_ISSUER,
  entireAccountIssuer,
  entireAuthorizeUrl,
  entireCodeChallenge,
  entireIdentityFromCode,
} from './account-entire.js';

describe('entireAccountIssuer', () => {
  it('accepts a single-label regional host', () => {
    expect(entireAccountIssuer('https://us.auth.entire.io')).toBe(ENTIRE_DEFAULT_ISSUER);
    expect(entireAccountIssuer('https://eu.auth.entire.io/')).toBe('https://eu.auth.entire.io');
  });

  it('rejects the apex, other hosts, and extra URL parts', () => {
    expect(entireAccountIssuer('https://auth.entire.io')).toBeNull();
    expect(entireAccountIssuer('https://us.auth.entire.io.evil.com')).toBeNull();
    expect(entireAccountIssuer('http://us.auth.entire.io')).toBeNull();
    expect(entireAccountIssuer('https://us.auth.entire.io/oauth/token')).toBeNull();
    expect(entireAccountIssuer('https://foo.bar.auth.entire.io')).toBeNull();
    expect(entireAccountIssuer('https://user:pass@us.auth.entire.io')).toBeNull();
  });
});

describe('entireAuthorizeUrl', () => {
  it('sends PKCE to the apex and leaves the client secret out', () => {
    const url = new URL(
      entireAuthorizeUrl('sideboard', 'https://relay.example/remote/oauth/callback', 'state', entireCodeChallenge('verifier')),
    );
    expect(url.origin).toBe('https://auth.entire.io');
    expect(url.pathname).toBe('/authorize');
    expect(url.searchParams.get('client_id')).toBe('sideboard');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(entireCodeChallenge('verifier'));
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.search).not.toContain('secret');
  });
});

describe('entireIdentityFromCode', () => {
  const redirect = 'https://relay.sideboard.cloud/remote/oauth/callback';
  const ctx = { codeVerifier: 'verifier', issuer: 'https://us.auth.entire.io' };

  it('keeps a public client id in the body and off the Authorization header', async () => {
    const clientId = 'https://www.sideboard.cloud/oauth/entire-client.json';
    let authorization: string | null = 'unset';
    await entireIdentityFromCode(clientIdClient(clientId), 'code', redirect, ctx, async (input, init) => {
      const url = String(input);
      if (url.endsWith('/oauth/token')) {
        authorization = new Headers(init?.headers).get('authorization');
        const params = new URLSearchParams(String(init?.body));
        expect(params.get('client_id')).toBe(clientId);
        expect(params.has('client_secret')).toBe(false);
        return new Response(JSON.stringify({ access_token: 'tok' }));
      }
      return userinfo();
    });
    expect(authorization).toBeNull();
  });

  it('sends HTTP Basic only when a client secret is configured', async () => {
    let authorization: string | null = null;
    await entireIdentityFromCode(
      { clientId: 'entire-app', clientSecret: 's3cret' },
      'code',
      redirect,
      ctx,
      async (input, init) => {
        const url = String(input);
        if (url.endsWith('/oauth/token')) {
          authorization = new Headers(init?.headers).get('authorization');
          return new Response(JSON.stringify({ access_token: 'tok' }));
        }
        return userinfo();
      },
    );
    expect(authorization).toBe(`Basic ${Buffer.from('entire-app:s3cret').toString('base64')}`);
  });
});

describe('hosted Entire client metadata', () => {
  it('uses the document URL as client_id and the relay callback as redirect', () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), '../../../../site/oauth/entire-client.json');
    const doc = JSON.parse(readFileSync(path, 'utf8')) as {
      client_id: string;
      redirect_uris: string[];
      token_endpoint_auth_method: string;
      response_types: string[];
    };
    expect(doc.client_id).toBe('https://www.sideboard.cloud/oauth/entire-client.json');
    expect(doc.redirect_uris).toEqual(['https://relay.sideboard.cloud/remote/oauth/callback']);
    expect(doc.token_endpoint_auth_method).toBe('none');
    expect(doc.response_types).toEqual(['code']);
  });
});

function clientIdClient(clientId: string) {
  return { clientId };
}

function userinfo(): Response {
  return new Response(JSON.stringify({ sub: 'user_entire', email: 'ada@example.com', email_verified: true }));
}
