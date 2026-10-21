/** Keep in step with `normalizeRemoteRelayUrl` in packages/core. */
export function normalizeRelayUrl(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `wss://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
  if (url.username || url.password) return null;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/' && path !== '/remote') return null;
  url.pathname = '/remote';
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * Socket address for the Relay field. A blank field uses the hosted default.
 * A typed value that is not a relay (a docs page, a health URL, a bad path)
 * stays invalid — do not pair against the hosted host while the field shows
 * something else.
 */
export function relaySocketUrl(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return normalizeRelayUrl(fallback) || fallback;
  return normalizeRelayUrl(trimmed) ?? '';
}
