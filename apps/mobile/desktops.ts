import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'sideboard.paired-desktops';

export type SavedDesktop = {
  deviceId: string;
  deviceLabel: string;
  sessionToken: string;
  /** Mac public key pinned from the pairing line. */
  hostPublicKey: string;
  /** Proved inside the encrypted handshake. Never sent to the relay. */
  phoneToken: string;
};

function isSaved(value: unknown): value is SavedDesktop {
  if (!value || typeof value !== 'object') return false;
  const row = value as SavedDesktop;
  return Boolean(row.deviceId && row.deviceLabel && row.sessionToken && row.hostPublicKey && row.phoneToken);
}

export async function loadDesktops(): Promise<SavedDesktop[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSaved);
  } catch {
    return [];
  }
}

export async function saveDesktops(desktops: SavedDesktop[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(desktops));
  } catch {
    // The in-memory list still works for this launch.
  }
}
