import {
  disconnectRemoteAccount,
  ensureRemoteHostCredentials,
  isRemoteAccountLoginCancelled,
  loadAppSettings,
  remoteRelayUrl,
  runRemoteHost,
  startRemoteAccountLogin,
  toPublicAppSettings,
  updateIntegrationsSettings,
  type PublicAppSettings,
  type RelayAccountProvider,
  type RemoteHostStatus,
} from '@sideboard-ai/core';
import type { BrowserWindow } from 'electron';
import { transcribeWavFile } from './speech-dictate';

let onActivity: () => void = () => {};
let onOpenWorktreeFile: NonNullable<Parameters<typeof runRemoteHost>[0]['onOpenWorktreeFile']> | null =
  null;

type PhoneOpenFile = NonNullable<Parameters<typeof runRemoteHost>[0]['onOpenWorktreeFile']>;

export function bindPhoneOpenFile(fn: PhoneOpenFile): void {
  onOpenWorktreeFile = fn;
}

export function showPhoneFile(win: BrowserWindow | null, request: Parameters<PhoneOpenFile>[0]): void {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('phone:open-file', request);
}

export function bindRemoteHostActivity(fn: () => void): void {
  onActivity = fn;
}

let remoteHostRunning = false;
let remoteConnected = false;
let remotePhoneConnected = false;
let remotePairingCode: string | null = null;
let remoteLastError: string | null = null;
let remoteLastLog: string | null = null;
let remoteAbort: AbortController | null = null;
let remoteRequestPair: (() => void) | null = null;
let remoteUpdateIdentity: ((deviceLabel: string) => void) | null = null;
const pairingWaiters = new Set<(code: string) => void>();

export function isRemoteHostRunning(): boolean {
  return remoteHostRunning;
}

export function readRemoteStatus(): RemoteHostStatus {
  const device = ensureRemoteHostCredentials();
  return {
    running: remoteHostRunning,
    connected: remoteConnected,
    deviceLabel: device.deviceLabel,
    phoneConnected: remotePhoneConnected,
    pairingCode: remotePairingCode,
    lastError: remoteLastError,
    lastLog: remoteLastLog,
  };
}

export function stopRemoteHost(): void {
  remoteAbort?.abort();
  remoteAbort = null;
  remoteRequestPair = null;
  remoteUpdateIdentity = null;
  pairingWaiters.clear();
  remoteHostRunning = false;
  remoteConnected = false;
  remotePhoneConnected = false;
  remotePairingCode = null;
  onActivity();
}

export function startRemoteHost(): void {
  if (remoteAbort) return;
  const creds = ensureRemoteHostCredentials();
  const ac = new AbortController();
  remoteAbort = ac;
  remoteHostRunning = true;
  remoteLastError = null;
  remoteLastLog = 'Starting phone remote…';
  onActivity();
  const handle = runRemoteHost({
    url: remoteRelayUrl(),
    deviceId: creds.deviceId,
    deviceLabel: creds.deviceLabel,
    hostSecret: creds.hostSecret,
    accountToken: loadAppSettings().integrations.remoteAccountToken,
    signal: ac.signal,
    onPairingCode: (code) => {
      remotePairingCode = code;
      if (!code) return;
      for (const waiter of pairingWaiters) waiter(code);
      pairingWaiters.clear();
      onActivity();
    },
    onStatus: (status) => {
      remoteConnected = status.connected;
      remotePhoneConnected = status.phoneConnected;
      if (status.phoneConnected) remotePairingCode = null;
    },
    onLog: (line) => {
      remoteLastLog = line;
      if (line.startsWith('remote error:')) remoteLastError = line;
      else if (line.startsWith('Remote connected') || line.startsWith('phone joined')) {
        remoteLastError = null;
      }
    },
    transcribeWav: (wavBase64) => transcribeWavFile(Buffer.from(wavBase64, 'base64')),
    onOpenWorktreeFile: (request) => onOpenWorktreeFile?.(request),
  });
  remoteRequestPair = () => handle.requestPairingCode();
  remoteUpdateIdentity = (label) => handle.updateIdentity(label);
}

export function restartRemoteHost(): void {
  stopRemoteHost();
  startRemoteHost();
}

export function refreshRemoteDeviceLabel(): void {
  const creds = ensureRemoteHostCredentials();
  if (remoteUpdateIdentity) remoteUpdateIdentity(creds.deviceLabel);
  else startRemoteHost();
}

export function requestRemotePairing(): Promise<RemoteHostStatus> {
  const previous = remotePairingCode;
  if (!remoteRequestPair) return Promise.resolve(readRemoteStatus());
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      pairingWaiters.delete(onCode);
      resolve(readRemoteStatus());
    };
    const onCode = (code: string) => {
      if (code !== previous) finish();
    };
    const timer = setTimeout(finish, 5000);
    pairingWaiters.add(onCode);
    remoteRequestPair?.();
    if (remotePairingCode && remotePairingCode !== previous) finish();
  });
}

let remoteAccountAbort: AbortController | null = null;

export async function signInRemoteAccount(
  provider: RelayAccountProvider,
  openUrl: (url: string) => void | Promise<void>,
): Promise<PublicAppSettings> {
  if (provider !== 'github') throw new Error('Sign in with the git host.');
  remoteAccountAbort?.abort();
  const ac = new AbortController();
  remoteAccountAbort = ac;
  try {
    const session = await startRemoteAccountLogin({
      provider,
      openUrl,
      signal: ac.signal,
    });
    const saved = updateIntegrationsSettings({
      remoteAccountToken: session.credential,
      remoteAccountEmail: session.email,
    });
    restartRemoteHost();
    return toPublicAppSettings(saved);
  } catch (err) {
    if (isRemoteAccountLoginCancelled(err)) throw new Error('Sign-in cancelled');
    throw err;
  } finally {
    if (remoteAccountAbort === ac) remoteAccountAbort = null;
  }
}

export async function signOutRemoteAccount(): Promise<PublicAppSettings> {
  const token = loadAppSettings().integrations.remoteAccountToken;
  if (token) {
    try {
      await disconnectRemoteAccount({ accountToken: token });
    } catch {
      // The local credential still has to go, even if the relay is unreachable.
    }
  }
  const saved = updateIntegrationsSettings({
    remoteAccountToken: null,
    remoteAccountEmail: null,
  });
  restartRemoteHost();
  return toPublicAppSettings(saved);
}
