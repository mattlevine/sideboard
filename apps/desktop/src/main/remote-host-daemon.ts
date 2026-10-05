import {
  ensureRemoteHostCredentials,
  remoteRelayUrl,
  runRemoteHost,
  type RemoteHostStatus,
} from '@sideboard-ai/core';

let onActivity: () => void = () => {};

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
    signal: ac.signal,
    onPairingCode: (code) => {
      remotePairingCode = code;
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

export function requestRemotePairing(): RemoteHostStatus {
  remoteRequestPair?.();
  return readRemoteStatus();
}
