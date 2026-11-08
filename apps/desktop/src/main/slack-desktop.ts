import { shell } from 'electron';
import { ipcMain } from 'electron';
import {
  connectSlackToken,
  createSlackOrgApp,
  disconnectSlackWorkspace,
  ensureSlackDeviceIdentity,
  hasBakedSlackOAuth,
  isSlackOAuthCancelled,
  listSlackWorkspaces,
  loadAppSettings,
  mergeSlackClientIds,
  remoteRelayUrl,
  resolveSlackListenMode,
  runSlackListen,
  saveSlackOrgCredentials,
  slackAppLevelToken,
  slackRelayUrl,
  startSlackOAuth,
  toPublicAppSettings,
  updateIntegrationsSettings,
  type SlackListenStatus,
  type SlackOrgRegistration,
} from '@sideboard-ai/core';

let slackListenAbort: AbortController | null = null;
let slackListenRunning = false;
let slackListenLastError: string | null = null;
let slackListenLastLog: string | null = null;
let slackOauthAbort: AbortController | null = null;
let onActivity: () => void = () => undefined;

export function slackListenIsRunning(): boolean {
  return slackListenRunning;
}

/** Slack listens on the same relay as the phone, at `/slack/desktop`. */
function activeSlackRelayUrl(): string {
  if (process.env.SIDEBOARD_SLACK_RELAY_URL?.trim()) return slackRelayUrl();
  try {
    const url = new URL(remoteRelayUrl(loadAppSettings().integrations.remoteRelayUrl));
    url.pathname = '/slack/desktop';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return slackRelayUrl();
  }
}

export function readSlackListenStatus(): SlackListenStatus {
  const settings = loadAppSettings();
  const workspaceCount = listSlackWorkspaces().length;
  const hasAppToken = Boolean(slackAppLevelToken(settings));
  const mode = resolveSlackListenMode({
    relayUrl: activeSlackRelayUrl(),
  });
  const device =
    workspaceCount > 0 || settings.integrations.slackDeviceId
      ? ensureSlackDeviceIdentity(settings)
      : null;
  return {
    enabled: workspaceCount > 0,
    running: slackListenRunning,
    hasAppToken,
    bakedOAuth: hasBakedSlackOAuth(),
    mode,
    workspaceCount,
    deviceLabel: device?.deviceLabel ?? null,
    lastError: slackListenLastError,
    lastLog: slackListenLastLog,
  };
}

export function stopSlackListenDaemon(): void {
  if (slackListenAbort) {
    slackListenAbort.abort();
    slackListenAbort = null;
  }
  if (slackListenRunning) {
    slackListenRunning = false;
    onActivity();
  }
}

export function syncSlackListenDaemon(): SlackListenStatus {
  stopSlackListenDaemon();
  const status = readSlackListenStatus();
  if (!status.enabled || status.mode !== 'relay') return status;
  const ac = new AbortController();
  slackListenAbort = ac;
  slackListenRunning = true;
  slackListenLastError = null;
  onActivity();
  void listenLoop(ac);
  return readSlackListenStatus();
}

async function listenLoop(ac: AbortController): Promise<void> {
  while (!ac.signal.aborted) {
    try {
      await runSlackListen({
        signal: ac.signal,
        relayUrl: activeSlackRelayUrl(),
        onLog: (line) => {
          slackListenLastLog = line;
        },
      });
    } catch (err) {
      if (ac.signal.aborted) return;
      slackListenLastError = err instanceof Error ? err.message : String(err);
    }
    if (ac.signal.aborted) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3_000);
      ac.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}

function setSlackListen(opts: { enabled: boolean }): SlackListenStatus {
  updateIntegrationsSettings({ slackListenEnabled: opts.enabled });
  if (opts.enabled) return syncSlackListenDaemon();
  stopSlackListenDaemon();
  return readSlackListenStatus();
}

function rememberSlackClientId(clientId: string) {
  const integrations = loadAppSettings().integrations;
  return updateIntegrationsSettings({
    slackClientIds: mergeSlackClientIds([
      ...(integrations.slackClientIds ?? []),
      integrations.slackClientId,
      clientId,
    ]),
  });
}

function forgetSlackClientId(clientId: string) {
  const drop = clientId.trim();
  const integrations = loadAppSettings().integrations;
  const ids = mergeSlackClientIds([
    ...(integrations.slackClientIds ?? []),
    integrations.slackClientId,
  ]).filter((id) => id !== drop);
  return updateIntegrationsSettings({
    slackClientIds: ids,
    slackClientId: integrations.slackClientId?.trim() === drop ? null : integrations.slackClientId,
  });
}

/** Slack IPC and the Listen loop. Call once from the desktop main process. */
export function registerSlackDesktop(notify: () => void): void {
  onActivity = notify;
  ipcMain.handle('getSlackWorkspaces', () => listSlackWorkspaces());
  ipcMain.handle('connectSlackToken', async (_e, token: string) => {
    await connectSlackToken(token);
    syncSlackListenDaemon();
    return listSlackWorkspaces();
  });
  ipcMain.handle('startSlackOAuth', async (_e, clientId?: string) => {
    slackOauthAbort?.abort();
    const ac = new AbortController();
    slackOauthAbort = ac;
    try {
      await startSlackOAuth({
        ...(typeof clientId === 'string' && clientId.trim() ? { clientId: clientId.trim() } : {}),
        openUrl: (url) => shell.openExternal(url),
        signal: ac.signal,
      });
      syncSlackListenDaemon();
      return listSlackWorkspaces();
    } catch (err) {
      if (isSlackOAuthCancelled(err)) throw new Error('Slack sign-in cancelled');
      throw err;
    } finally {
      if (slackOauthAbort === ac) slackOauthAbort = null;
    }
  });
  ipcMain.handle('cancelSlackOAuth', () => {
    slackOauthAbort?.abort();
  });
  ipcMain.handle('disconnectSlackWorkspace', (_e, teamId: string) => {
    const list = disconnectSlackWorkspace(teamId);
    syncSlackListenDaemon();
    return list;
  });
  ipcMain.handle('getSlackListenStatus', () => readSlackListenStatus());
  ipcMain.handle('setSlackListen', (_e, opts: { enabled: boolean }) => setSlackListen(opts));
  ipcMain.handle('createSlackOrgApp', async (): Promise<SlackOrgRegistration> => {
    const token = loadAppSettings().integrations.remoteAccountToken?.trim() ?? '';
    return createSlackOrgApp({ accountToken: token, relayWsUrl: slackRelayUrl() });
  });
  ipcMain.handle(
    'saveSlackOrgCredentials',
    async (
      _e,
      input: { registrationId: string; writeToken: string; clientId: string; clientSecret: string; signingSecret: string },
    ) => {
      await saveSlackOrgCredentials({ ...input, relayWsUrl: slackRelayUrl() });
      return toPublicAppSettings(rememberSlackClientId(input.clientId));
    },
  );
  ipcMain.handle('addSlackClientId', (_e, clientId: string) =>
    toPublicAppSettings(rememberSlackClientId(clientId)),
  );
  ipcMain.handle('removeSlackClientId', (_e, clientId: string) =>
    toPublicAppSettings(forgetSlackClientId(clientId)),
  );
}
