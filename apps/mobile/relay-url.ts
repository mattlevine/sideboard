import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeRelayUrl } from './relay-address';

export { normalizeRelayUrl, relaySocketUrl } from './relay-address';

const KEY = 'sideboard.relay-url';

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
