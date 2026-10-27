import { createHash, randomBytes } from 'node:crypto';
import type { RelaySignInIdentity } from './accounts.js';

/** Apex authorize host. It dispatches to a regional issuer and is not an issuer itself. */
export const ENTIRE_AUTHORIZE_ORIGIN = 'https://auth.entire.io';

/** Used when the callback omits RFC 9207 `iss`. Regional callbacks should send `iss`. */
export const ENTIRE_DEFAULT_ISSUER = 'https://us.auth.entire.io';

const ISSUER_SUFFIX = '.auth.entire.io';

export type EntireOAuthClient = { clientId: string; clientSecret?: string };

/**
 * Regional Entire issuer (`https://us.auth.entire.io`). The apex
 * `auth.entire.io` only redirects. Rejects other hosts, ports, and paths.
 */
export function entireAccountIssuer(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? '';
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(ISSUER_SUFFIX)) return null;
  const label = host.slice(0, -ISSUER_SUFFIX.length);
  if (!/^[a-z0-9]+$/.test(label)) return null;
  return `https://${host}`;
}

export function newEntireCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function entireCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Browser sign-in. PKCE is required; the client secret never appears in this URL. */
export function entireAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  const url = new URL('/authorize', ENTIRE_AUTHORIZE_ORIGIN);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Entire returned a non-JSON response.');
  }
}

function accessToken(body: unknown): string {
  const token = (body as { access_token?: unknown }).access_token;
  if (typeof token === 'string' && token.trim()) return token.trim();
  const described = (body as { error_description?: unknown }).error_description;
  const code = (body as { error?: unknown }).error;
  const message = typeof described === 'string' && described.trim() ? described : code;
  throw new Error(
    typeof message === 'string' && message.trim() ? message : 'Entire rejected the sign-in code.',
  );
}

/**
 * Exchange the authorization code at the regional issuer and read the account.
 * The relay keeps the Sideboard credential, not this access token.
 */
export async function entireIdentityFromCode(
  client: EntireOAuthClient,
  code: string,
  redirectUri: string,
  ctx: { codeVerifier: string | null; issuer: string | null },
  fetchImpl: typeof fetch,
): Promise<RelaySignInIdentity> {
  if (!ctx.codeVerifier) throw new Error('Entire sign-in could not be verified.');
  const issuer = ctx.issuer?.trim()
    ? entireAccountIssuer(ctx.issuer)
    : ENTIRE_DEFAULT_ISSUER;
  if (!issuer) throw new Error('Entire sign-in came from an unexpected issuer.');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: client.clientId,
    code_verifier: ctx.codeVerifier,
  });
  // Public clients (including a Client ID Metadata Document URL) authenticate
  // with PKCE only. HTTP Basic splits on the first colon, so a URL client id
  // cannot be a Basic username.
  const secret = client.clientSecret?.trim() ?? '';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (secret) {
    headers.Authorization = `Basic ${Buffer.from(`${client.clientId}:${secret}`).toString('base64')}`;
  }
  const tokenRes = await fetchImpl(`${issuer}/oauth/token`, {
    method: 'POST',
    redirect: 'error',
    headers,
    body,
  });
  const token = accessToken(await readJson(tokenRes));
  const userRes = await fetchImpl(`${issuer}/userinfo`, {
    redirect: 'error',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw new Error('Entire did not return an account.');
  const user = (await readJson(userRes)) as {
    sub?: unknown;
    email?: unknown;
    email_verified?: unknown;
  };
  const subject = typeof user.sub === 'string' ? user.sub.trim() : '';
  if (!subject) throw new Error('Entire did not return an account id.');
  const email = typeof user.email === 'string' ? user.email.trim() : '';
  const emailVerified = user.email_verified === true && Boolean(email);
  return {
    issuer,
    subject,
    email: emailVerified ? email : null,
    emailVerified,
  };
}

/** Relay registry entry. Public clients use PKCE; the client id may be a metadata-document URL. */
export function entireGitHostEntry() {
  return {
    label: 'Entire',
    requiresClientSecret: false,
    credentialParam: 'code' as const,
    authorizeUrl(
      client: { clientId: string },
      redirectUri: string,
      state: string,
      ctx: { codeVerifier: string | null },
    ) {
      if (!ctx.codeVerifier) throw new Error('Entire sign-in could not start.');
      return entireAuthorizeUrl(client.clientId, redirectUri, state, entireCodeChallenge(ctx.codeVerifier));
    },
    fetchIdentity(
      client: { clientId: string; clientSecret?: string },
      code: string,
      redirectUri: string,
      _state: string,
      fetchImpl: typeof fetch,
      ctx: { codeVerifier: string | null; issuer: string | null },
    ) {
      return entireIdentityFromCode(client, code, redirectUri, ctx, fetchImpl);
    },
  };
}
