import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'sideboard.relay-url';

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

export async function loadRelayUrl(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return normalizeRelayUrl(raw);
  } catch {
    return null;
  }
}

export async function saveRelayUrl(url: string): Promise<void> {
  try {
    if (!url.trim()) {
      await AsyncStorage.removeItem(KEY);
      return;
    }
    const next = normalizeRelayUrl(url);
    if (!next) return;
    await AsyncStorage.setItem(KEY, next);
  } catch {
    // The field still applies for this launch.
  }
}
