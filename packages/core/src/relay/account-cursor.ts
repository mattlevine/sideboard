import { createPublicKey, verify } from 'node:crypto';
import { CURSOR_ACCOUNT_ISSUER, type RelaySignInIdentity } from './accounts.js';

const JWKS_URL = 'https://api.cursor.com/v1/origin/keys';
const RECEIPT_TYP = 'origin-user-confirmation-receipt+jwt';

const usedJti = new Map<string, number>();

type Jwk = { kty?: string; crv?: string; x?: string; kid?: string };

function b64urlJson(segment: string): unknown {
  return JSON.parse(b64urlBuf(segment).toString('utf8')) as unknown;
}

function b64urlBuf(segment: string): Buffer {
  const pad = segment.length % 4 === 0 ? '' : '='.repeat(4 - (segment.length % 4));
  return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function rememberJti(jti: string, expMs: number, nowMs: number): boolean {
  for (const [id, exp] of usedJti) {
    if (exp < nowMs) usedJti.delete(id);
  }
  if (usedJti.has(jti)) return false;
  usedJti.set(jti, expMs);
  return true;
}

/** Browser confirmation. The app must already be installed in the user's namespace. */
export function cursorAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL('https://cursor.com/codebase/apps/user-confirmation');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * Origin returns a signed receipt instead of an authorization code.
 * The email is the account the user just confirmed, so it can link hosts.
 */
export async function cursorIdentityFromReceipt(
  receipt: string,
  expected: { clientId: string; state: string },
  fetchImpl: typeof fetch,
  nowMs = Date.now(),
): Promise<RelaySignInIdentity> {
  const parts = receipt.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Cursor sign-in receipt was not a signed token.');
  }
  const [hSeg, pSeg, sSeg] = parts;
  const header = b64urlJson(hSeg) as { alg?: unknown; kid?: unknown; typ?: unknown };
  if (header.alg !== 'EdDSA' || header.typ !== RECEIPT_TYP || typeof header.kid !== 'string') {
    throw new Error('Cursor sign-in receipt was not a user confirmation.');
  }
  const payload = b64urlJson(pSeg) as Record<string, unknown>;
  if (payload.iss !== CURSOR_ACCOUNT_ISSUER) {
    throw new Error('Cursor sign-in receipt came from an unexpected issuer.');
  }
  if (payload.aud !== expected.clientId) throw new Error('Cursor sign-in receipt was for a different app.');
  if (payload.state !== expected.state) throw new Error('Cursor sign-in did not match this attempt.');
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (!exp || exp * 1000 < nowMs) throw new Error('Cursor sign-in receipt expired.');
  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub) throw new Error('Cursor did not return an account id.');
  const jti = typeof payload.jti === 'string' ? payload.jti.trim() : '';
  if (!jti) throw new Error('Cursor sign-in receipt was missing an id.');

  const jwksRes = await fetchImpl(JWKS_URL);
  const body = (await jwksRes.json()) as { keys?: Jwk[] };
  const jwk = (body.keys ?? []).find(
    (key) => key.kid === header.kid && key.kty === 'OKP' && key.crv === 'Ed25519' && key.x,
  );
  if (!jwk?.x) throw new Error('Cursor did not publish the key that signed this receipt.');
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
  const ok = verify(null, Buffer.from(`${hSeg}.${pSeg}`), key, b64urlBuf(sSeg));
  if (!ok) throw new Error('Cursor sign-in receipt signature did not verify.');
  if (!rememberJti(jti, exp * 1000, nowMs)) throw new Error('Cursor sign-in receipt was already used.');

  const email = typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim() : null;
  return {
    issuer: CURSOR_ACCOUNT_ISSUER,
    subject: sub,
    email,
    emailVerified: Boolean(email),
  };
}
