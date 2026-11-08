import { randomBytes } from 'node:crypto';

/**
 * OAuth `state` for a company app embeds the public client id so the relay
 * can pick that app's secret. The baked Sideboard app keeps a random state.
 */
export function slackOAuthState(clientId: string, bakedClientId: string): string {
  const nonce = randomBytes(16).toString('hex');
  const id = clientId.trim();
  if (!id || id === bakedClientId.trim()) return nonce;
  return `c.${Buffer.from(id, 'utf8').toString('base64url')}.${nonce}`;
}

export function clientIdFromOAuthState(state: string): string | null {
  if (!state.startsWith('c.')) return null;
  const rest = state.slice(2);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return null;
  if (!/^[0-9a-f]{32}$/.test(rest.slice(dot + 1))) return null;
  try {
    const id = Buffer.from(rest.slice(0, dot), 'base64url').toString('utf8').trim();
    if (!id || id.includes('\0')) return null;
    return id;
  } catch {
    return null;
  }
}
