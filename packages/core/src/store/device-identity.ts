import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { generateHostSecretKey } from '../remote/phone-e2ee.js';
import {
  loadAppSettings,
  updateIntegrationsSettings,
  type AppSettings,
} from './app-settings.js';
import { loadSecretVault, saveSecretVault } from './secret-vault.js';

/**
 * Stable per-Mac identity on the relay so Personal and Work can both
 * stay online as separate destinations. Phone remote uses the same id.
 */
export function ensureSlackDeviceIdentity(
  settings: AppSettings = loadAppSettings(),
): { deviceId: string; deviceLabel: string } {
  let deviceId = settings.integrations.slackDeviceId?.trim() ?? '';
  let deviceLabel = settings.integrations.slackDeviceLabel?.trim() ?? '';
  const patch: { slackDeviceId?: string; slackDeviceLabel?: string } = {};
  if (!deviceId) {
    deviceId = randomUUID();
    patch.slackDeviceId = deviceId;
  }
  if (!deviceLabel) {
    try {
      deviceLabel = hostname().split('.')[0]?.trim() || 'This Mac';
    } catch {
      deviceLabel = 'This Mac';
    }
    patch.slackDeviceLabel = deviceLabel;
  }
  if (Object.keys(patch).length > 0) {
    updateIntegrationsSettings(patch);
  }
  return { deviceId, deviceLabel };
}

/** Mac identity plus the secrets the phone relay and the phone session use. */
export function ensureRemoteHostCredentials(
  settings: AppSettings = loadAppSettings(),
): {
  deviceId: string;
  deviceLabel: string;
  hostSecret: string;
  hostPrivateKey: string;
  phoneToken: string | null;
} {
  const device = ensureSlackDeviceIdentity(settings);
  let hostSecret = loadAppSettings().integrations.remoteHostSecret?.trim() ?? '';
  if (!hostSecret) {
    hostSecret = randomUUID();
    updateIntegrationsSettings({ remoteHostSecret: hostSecret });
  }
  const vault = loadSecretVault();
  let hostPrivateKey = vault.remoteHostPrivateKey?.trim() ?? '';
  if (!hostPrivateKey) {
    hostPrivateKey = generateHostSecretKey();
    saveSecretVault({ ...loadSecretVault(), remoteHostPrivateKey: hostPrivateKey });
  }
  const phoneToken = loadSecretVault().remotePhoneToken?.trim() || null;
  return { ...device, hostSecret, hostPrivateKey, phoneToken };
}

/** Remember the phone token after an encrypted handshake. A new pairing replaces it. */
export function saveRemotePhoneToken(token: string): void {
  const next = token.trim();
  if (!next) return;
  saveSecretVault({ ...loadSecretVault(), remotePhoneToken: next });
}
