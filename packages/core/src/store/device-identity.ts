import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  loadAppSettings,
  updateIntegrationsSettings,
  type AppSettings,
} from './app-settings.js';

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

/** Mac identity plus the secret the phone relay uses to recognize this machine. */
export function ensureRemoteHostCredentials(
  settings: AppSettings = loadAppSettings(),
): { deviceId: string; deviceLabel: string; hostSecret: string } {
  const device = ensureSlackDeviceIdentity(settings);
  let hostSecret = loadAppSettings().integrations.remoteHostSecret?.trim() ?? '';
  if (!hostSecret) {
    hostSecret = randomUUID();
    updateIntegrationsSettings({ remoteHostSecret: hostSecret });
  }
  return { ...device, hostSecret };
}
