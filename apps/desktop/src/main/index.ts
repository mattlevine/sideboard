import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  net,
  shell,
} from 'electron';
import {
  destroyUrlPreview,
  hideUrlPreview,
  navigateUrlPreview,
  reloadUrlPreview,
  setUrlPreviewBounds,
  showUrlPreview,
  type UrlPreviewBounds,
} from './url-preview';
import {
  bindArtifactPreviewProtocol,
  registerArtifactPreviewScheme,
} from './artifact-preview';
import { bindUpdaterEvents, checkForUpdatesManual, setupApplicationMenu } from './app-menu';
import { initDesktopSecretVault } from './secret-vault';
import {
  caffeinateIndicatorReasons,
  caffeinateIndicatorTooltip,
  caffeinateTrayPng,
  paintCaffeinateDockBadge,
} from './caffeinate-indicator';

// Must run before app.ready so artifact iframes can load outside renderer CSP.
registerArtifactPreviewScheme();

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { watch, type FSWatcher } from 'chokidar';
import { autoUpdater } from 'electron-updater';
import {
  applyAppEnvironment,
  attachmentFromAbsolutePath,
  attachmentsFromBuffers,
  brightsyCloudConnectAgent,
  brightsyCloudConnectEnabled,
  BrightsySideboardApi,
  caffeinateHoldPath,
  caffeinateWhileRunningEnabled,
  caffeinateWhileSlackListenEnabled,
  caffeinateWhileSchedulesEnabled,
  getCaffeinateHold,
  setCaffeinateHold,
  claudeUserSettingsPath,
  detectAgents,
  ensureAgentPath,
  registerPackagedUserMcpClients,
  warmGithubAgentAuth,
  getAgentSetupInfo,
  claimDesktopHost,
  getOrchestrator,
  releaseDesktopHost,
  installAgent,
  listBranches,
  listBrightsyChatTargets,
  listCursorModels,
  listCodexModels,
  listOpencodeModels,
  getBrightsySession,
  switchBrightsyAccount,
  connectBrightsyTeam,
  disconnectBrightsyTeam,
  listPrs,
  listLinearIssues,
  listIssues,
  getHomeBoardInputs,
  addBoardPin,
  removeBoardPin,
  type AddBoardPinInput,
  getGitHubStatus,
  listSlackWorkspaces,
  connectSlackToken,
  disconnectSlackWorkspace,
  startSlackOAuth,
  isSlackOAuthCancelled,
  startLinearOAuth,
  isLinearOAuthCancelled,
  disconnectLinear,
  runSlackListen,
  resolveSlackListenMode,
  slackAppLevelToken,
  slackRelayUrl,
  hasBakedSlackOAuth,
  pollSlackOutboundWatches,
  getDefaultAgent,
  ensureSlackDeviceIdentity,
  loadAppSettings,
  toPublicAppSettings,
  loadBrightsyConfig,
  ensureBrightsyLocalConfigFresh,
  ensureConnectedBrightsyTeamTokens,
  loginAgent,
  maxConcurrentAgents,
  resolveRepoRoot,
  run,
  runCloudConnect,
  saveAppSettings,
  setHttpFetchImpl,
  startOrchestration,
  createGlobalChat,
  ensureCloudCoordinator,
  hasConductorHook,
  getRepoSetupInfo,
  threadsDir,
  isThreadRecordFile,
  schedulesPath,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  fireSchedule,
  armSchedules,
  hasEnabledSchedules,
  updateAdvancedSettings,
  updateAppEnvironment,
  updateBrightsySettings,
  updateClaudeSettings,
  updateAgentExecutable,
  updateDefaultsSettings,
  updateIntegrationsSettings,
  type AdvancedAppSettings,
  type AgentKind,
  type AdoptInput,
  type AppSettings,
  type Autonomy,
  type BrightsyCloudConnectAgent,
  type BrightsyHarnessSettings,
  type ClaudeHarnessSettings,
  type CliAgentKind,
  type CloudConnectStatus,
  type SlackListenStatus,
  type DefaultsAppSettings,
  type IntegrationsSettings,
  type IssueSource,
  type ThinkingEffort,
  type CreateThreadInput,
  type DiffScope,
  type OrchestratorEvent,
  type ThreadAttachment,
  type ThreadOptionsPatch,
  type CreateScheduledTaskInput,
  type UpdateScheduledTaskPatch,
} from '@sideboard-ai/core';
import { closeTsServer, setupTsServer } from './tsserver';

/** Walk up from `startDir` to the nearest `.git` (worktree root or repo checkout). */
function findWorktreeRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Unpackaged (dev) builds default to a per-worktree app-data directory
// (Conductor-style — session data lives under a dotfolder in the worktree)
// instead of the shared ~/Library/.../sideboard store. Two orchestrators
// draining the same thread's queue race and produce out-of-order turns, and
// that happens both against an installed Sideboard.app and between two
// worktrees' `pnpm dev` runs — scoping to the worktree root fixes both.
// Explicit SIDEBOARD_APP_DATA still wins.
if (!app.isPackaged && !process.env.SIDEBOARD_APP_DATA?.trim()) {
  const worktreeRoot = findWorktreeRoot(process.cwd());
  process.env.SIDEBOARD_APP_DATA = worktreeRoot
    ? join(worktreeRoot, '.sideboard', 'dev-app-data')
    : join(app.getPath('appData'), 'sideboard-dev');
}

let mainWindow: BrowserWindow | null = null;
let repoPath = '';
const orch = getOrchestrator();
let openFileWatcher: FSWatcher | null = null;
let openFileWatchKey: string | null = null;
let caffeinateProc: ChildProcess | null = null;
let caffeinateTray: Tray | null = null;

let cloudConnectAbort: AbortController | null = null;
let cloudConnectRunning = false;
let cloudConnectLastError: string | null = null;
let cloudConnectLastLog: string | null = null;

let slackListenAbort: AbortController | null = null;
let slackListenRunning = false;
let slackListenLastError: string | null = null;
let slackListenLastLog: string | null = null;

function readCloudConnectStatus(): CloudConnectStatus {
  const settings = loadAppSettings();
  let endpoint: string | null = null;
  try {
    endpoint = loadBrightsyConfig().endpoint?.replace(/\/$/, '') || 'https://brightsy.ai';
  } catch {
    endpoint = null;
  }
  return {
    enabled: brightsyCloudConnectEnabled(settings),
    running: cloudConnectRunning,
    agent: brightsyCloudConnectAgent(settings),
    endpoint,
    workspaces: orch.listWorkspaces(),
    lastError: cloudConnectLastError,
    lastLog: cloudConnectLastLog,
  };
}

function stopCloudConnectDaemon(): void {
  if (cloudConnectAbort) {
    cloudConnectAbort.abort();
    cloudConnectAbort = null;
  }
  cloudConnectRunning = false;
  syncCaffeinate();
}

function startCloudConnectDaemon(): void {
  if (cloudConnectAbort) return;
  const settings = loadAppSettings();
  if (!brightsyCloudConnectEnabled(settings)) return;

  const agent = brightsyCloudConnectAgent(settings);
  const ac = new AbortController();
  cloudConnectAbort = ac;
  cloudConnectRunning = true;
  cloudConnectLastError = null;
  cloudConnectLastLog = 'Starting Brightsy cloud connect…';
  syncCaffeinate();

  void runCloudConnect({
    agent,
    enableAccess: true,
    allowAlways: true,
    signal: ac.signal,
    // Chromium networking — avoids opaque Node undici "fetch failed" errors.
    fetchImpl: net.fetch.bind(net) as typeof fetch,
    onLog: (line) => {
      cloudConnectLastLog = line;
      if (line.startsWith('poll error:') || line.startsWith('error ')) {
        cloudConnectLastError = line;
      } else if (
        line.startsWith('Connected to Brightsy') ||
        line.startsWith('run ') ||
        line.startsWith('replied ') ||
        line.startsWith('busy ') ||
        line.startsWith('poll recovered')
      ) {
        cloudConnectLastError = null;
      }
    },
  })
    .catch((err) => {
      cloudConnectLastError = err instanceof Error ? err.message : String(err);
      cloudConnectLastLog = cloudConnectLastError;
    })
    .finally(() => {
      if (cloudConnectAbort === ac) {
        cloudConnectAbort = null;
        cloudConnectRunning = false;
        syncCaffeinate();
      }
    });
}

async function setCloudConnect(opts: {
  enabled?: boolean;
  agent?: BrightsyCloudConnectAgent;
}): Promise<CloudConnectStatus> {
  const patch: {
    cloudConnectEnabled?: boolean;
    cloudConnectAgent?: BrightsyCloudConnectAgent;
  } = {};
  if (typeof opts.enabled === 'boolean') {
    patch.cloudConnectEnabled = opts.enabled;
  }
  if (opts.agent) {
    patch.cloudConnectAgent = opts.agent;
  }
  if (Object.keys(patch).length > 0) {
    updateBrightsySettings(patch);
  }

  const enabled = brightsyCloudConnectEnabled();
  if (!enabled) {
    stopCloudConnectDaemon();
    // Best-effort: disable remote access when the user turns the UI off.
    if (opts.enabled === false) {
      try {
        await new BrightsySideboardApi({
          fetchImpl: net.fetch.bind(net) as typeof fetch,
        }).setAccess(false, false);
      } catch (err) {
        cloudConnectLastError =
          err instanceof Error ? err.message : String(err);
      }
    }
  } else {
    // Restart so agent/home changes take effect.
    stopCloudConnectDaemon();
    startCloudConnectDaemon();
  }
  return readCloudConnectStatus();
}

function readSlackListenStatus(): SlackListenStatus {
  const settings = loadAppSettings();
  const workspaceCount = listSlackWorkspaces().length;
  const hasAppToken = Boolean(slackAppLevelToken(settings));
  const mode = resolveSlackListenMode({
    relayUrl: slackRelayUrl(),
    workspaceCount,
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

function stopSlackListenDaemon(): void {
  if (slackListenAbort) {
    slackListenAbort.abort();
    slackListenAbort = null;
  }
  slackListenRunning = false;
  syncCaffeinate();
}

function startSlackListenDaemon(): void {
  if (slackListenAbort) return;
  const settings = loadAppSettings();
  if (listSlackWorkspaces().length === 0) return;
  ensureSlackDeviceIdentity(settings);
  const mode = resolveSlackListenMode({
    relayUrl: slackRelayUrl(),
    workspaceCount: listSlackWorkspaces().length,
  });
  if (!mode) {
    slackListenLastError =
      'Listen needs a connected workspace (Add via browser).';
    slackListenLastLog = slackListenLastError;
    return;
  }

  const ac = new AbortController();
  slackListenAbort = ac;
  slackListenRunning = true;
  slackListenLastError = null;
  slackListenLastLog = 'Starting Slack relay…';
  syncCaffeinate();

  void runSlackListen({
    agent: getDefaultAgent(settings),
    signal: ac.signal,
    fetchImpl: net.fetch.bind(net) as typeof fetch,
    onLog: (line) => {
      slackListenLastLog = line;
      if (
        line.startsWith('socket error:') ||
        line.startsWith('event error:') ||
        line.startsWith('relay error:') ||
        line.startsWith('post error:') ||
        line.startsWith('react error:')
      ) {
        slackListenLastError = line;
      } else if (
        line.startsWith('Relay connected') ||
        line.startsWith('Relay registered') ||
        line.startsWith('run ') ||
        line.startsWith('replied ') ||
        line.startsWith('busy ')
      ) {
        slackListenLastError = null;
      }
    },
  })
    .catch((err) => {
      slackListenLastError = err instanceof Error ? err.message : String(err);
      slackListenLastLog = slackListenLastError;
    })
    .finally(() => {
      if (slackListenAbort === ac) {
        slackListenAbort = null;
        slackListenRunning = false;
        syncCaffeinate();
      }
    });
}

function syncSlackListenDaemon(): SlackListenStatus {
  const mode = resolveSlackListenMode({
    relayUrl: slackRelayUrl(),
    workspaceCount: listSlackWorkspaces().length,
  });
  if (mode) {
    startSlackListenDaemon();
  } else {
    stopSlackListenDaemon();
  }
  return readSlackListenStatus();
}

function setSlackListen(opts: { enabled: boolean }): SlackListenStatus {
  updateIntegrationsSettings({ slackListenEnabled: opts.enabled });
  if (opts.enabled) return syncSlackListenDaemon();
  stopSlackListenDaemon();
  return readSlackListenStatus();
}

async function stopOpenFileWatcher(): Promise<void> {
  if (!openFileWatcher) {
    openFileWatchKey = null;
    return;
  }
  const prev = openFileWatcher;
  openFileWatcher = null;
  openFileWatchKey = null;
  await prev.close();
}

async function startOpenFileWatcher(threadRef: string, relativePath: string): Promise<void> {
  if (relativePath.includes('..') || relativePath.startsWith('/')) {
    throw new Error('Invalid path');
  }
  const thread = orch.getThread(threadRef);
  if (!thread) throw new Error(`Thread not found: ${threadRef}`);

  const absPath = join(thread.worktreePath, relativePath);
  const key = `${threadRef}\0${relativePath}`;
  if (openFileWatchKey === key && openFileWatcher) return;

  await stopOpenFileWatcher();
  openFileWatchKey = key;
  openFileWatcher = watch(absPath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
  });
  const notify = () => {
    if (openFileWatchKey !== key) return;
    mainWindow?.webContents.send('file:changed', {
      threadRef,
      path: relativePath,
    });
  };
  openFileWatcher.on('change', notify);
  openFileWatcher.on('add', notify);
  openFileWatcher.on('unlink', notify);
}

function resolveAppIcon(): string | null {
  const candidates = [
    join(__dirname, '../../build/icon.png'),
    join(__dirname, '../../build/icon.icns'),
    join(process.resourcesPath, 'icon.png'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

function applyDockIcon(): void {
  syncCaffeinateIndicator();
}

function overlayCaffeinateOnIcon(base: Electron.NativeImage): Electron.NativeImage {
  const size = 256;
  const resized = base.resize({ width: size, height: size });
  const bitmap = Buffer.from(resized.toBitmap());
  paintCaffeinateDockBadge(bitmap, size, size, {
    bgra: process.platform === 'darwin',
  });
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size });
}

function showMainWindow(): void {
  if (!mainWindow) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function destroyCaffeinateTray(): void {
  if (!caffeinateTray) return;
  caffeinateTray.destroy();
  caffeinateTray = null;
}

function caffeinateTrayImage(): Electron.NativeImage {
  const px = 44;
  return nativeImage.createFromBuffer(caffeinateTrayPng(px), {
    scaleFactor: 2,
  });
}

function syncCaffeinateTray(active: boolean, tooltip: string): void {
  if (process.platform !== 'darwin' || !active) {
    destroyCaffeinateTray();
    return;
  }
  const image = caffeinateTrayImage();
  if (!caffeinateTray) {
    caffeinateTray = new Tray(image);
    caffeinateTray.setIgnoreDoubleClickEvents(true);
    caffeinateTray.on('click', () => showMainWindow());
    caffeinateTray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Sideboard is keeping this Mac awake', enabled: false },
        { type: 'separator' },
        { label: 'Show Sideboard', click: () => showMainWindow() },
      ]),
    );
  } else {
    caffeinateTray.setImage(image);
  }
  caffeinateTray.setTitle('');
  caffeinateTray.setToolTip(tooltip);
}

function caffeinateUiState(): ReturnType<typeof getCaffeinateHold> & {
  appCaffeinated: boolean;
} {
  const hold = getCaffeinateHold();
  const reasons = caffeinateIndicatorReasons({
    holdHeld: hold.held,
    whileRunning: caffeinateWhileRunningEnabled(),
    agentsRunning: orch.getRuntime().running,
    whileSlackListen: caffeinateWhileSlackListenEnabled(),
    slackListenRunning,
    whileSchedules: caffeinateWhileSchedulesEnabled(),
    schedulesEnabled: hasEnabledSchedules(),
  });
  return { ...hold, appCaffeinated: reasons.length > 0 };
}

function syncCaffeinateIndicator(): void {
  const state = caffeinateUiState();
  const reasons = caffeinateIndicatorReasons({
    holdHeld: state.held,
    whileRunning: caffeinateWhileRunningEnabled(),
    agentsRunning: orch.getRuntime().running,
    whileSlackListen: caffeinateWhileSlackListenEnabled(),
    slackListenRunning,
    whileSchedules: caffeinateWhileSchedulesEnabled(),
    schedulesEnabled: hasEnabledSchedules(),
  });
  const active = state.appCaffeinated;
  const tooltip = caffeinateIndicatorTooltip(reasons);

  if (process.platform === 'darwin' && app.dock) {
    const path = resolveAppIcon();
    if (path) {
      const base = nativeImage.createFromPath(path);
      if (!base.isEmpty()) {
        app.dock.setIcon(active ? overlayCaffeinateOnIcon(base) : base);
      }
    }
    app.dock.setBadge('');
  }

  syncCaffeinateTray(active, tooltip);
  try {
    mainWindow?.webContents.send('caffeinate-hold:changed', state);
  } catch {
    // ignore
  }
}

function createWindow(): void {
  const icon = resolveAppIcon() ?? undefined;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Sideboard',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    hideUrlPreview(mainWindow);
    mainWindow = null;
  });
}

function notifyUpdate(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  n.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  n.show();
}

function setupUpdater(): void {
  bindUpdaterEvents(() => mainWindow);

  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Use checkForUpdates (not AndNotify) so we own in-app + OS notifications.
  const check = () => {
    void autoUpdater.checkForUpdates().catch(() => undefined);
  };
  check();
  setInterval(check, 4 * 60 * 60 * 1000);

  autoUpdater.on('update-available', (info) => {
    const version = info.version;
    mainWindow?.webContents.send('update:available', { version });
    notifyUpdate('Update available', `Sideboard ${version} is available and downloading in the background.`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    const version = info.version;
    mainWindow?.webContents.send('update:ready', { version });
    notifyUpdate('Update ready', `Sideboard ${version} is ready — restart to update.`);
  });

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update:error', {
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

function setupStoreWatcher(): void {
  const dir = threadsDir();
  const watcher = watch(dir, { ignoreInitial: true, depth: 0 });
  let adoptTimer: ReturnType<typeof setTimeout> | null = null;
  let notifyTimer: ReturnType<typeof setTimeout> | null = null;
  const flushNotify = () => {
    notifyTimer = null;
    mainWindow?.webContents.send('threads:changed');
    // MCP stdio (separate process) enqueues via send_to_thread; when that child
    // exits mid-wait, queues stay on disk. Adopt them into the desktop drain.
    if (adoptTimer) clearTimeout(adoptTimer);
    adoptTimer = setTimeout(() => {
      adoptTimer = null;
      try {
        orch.adoptPersistedQueues();
      } catch {
        // Best-effort — next change or startup reconcile will retry.
      }
    }, 250);
  };
  const notify = (changed: string) => {
    // Ignore `<id>.live.json` and atomic `*.tmp` — those fire on every tool
    // chunk and made the renderer re-parse every thread JSON on the UI thread.
    if (!isThreadRecordFile(changed)) return;
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(flushNotify, 250);
  };
  watcher.on('add', notify);
  watcher.on('change', notify);
  watcher.on('unlink', notify);
  app.on('will-quit', () => {
    if (notifyTimer) clearTimeout(notifyTimer);
    if (adoptTimer) clearTimeout(adoptTimer);
    void watcher.close();
  });
}

function setupSchedulesWatcher(): void {
  const file = schedulesPath();
  const dir = dirname(file);
  const name = basename(file);
  mkdirSync(dir, { recursive: true });
  const watcher = watch(dir, { ignoreInitial: true, depth: 0 });
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  const notify = (changed: string) => {
    if (basename(changed) !== name) return;
    mainWindow?.webContents.send('schedules:changed');
    if (armTimer) clearTimeout(armTimer);
    armTimer = setTimeout(() => {
      armTimer = null;
      try {
        armSchedules();
        syncCaffeinate();
      } catch {
        // Best-effort — next change or startup will retry.
      }
    }, 250);
  };
  watcher.on('add', notify);
  watcher.on('change', notify);
  watcher.on('unlink', notify);
  app.on('will-quit', () => {
    if (armTimer) clearTimeout(armTimer);
    void watcher.close();
  });
}

function setupCaffeinateHoldWatcher(): void {
  const file = caffeinateHoldPath();
  const dir = dirname(file);
  const name = basename(file);
  mkdirSync(dir, { recursive: true });
  const watcher = watch(dir, { ignoreInitial: true, depth: 0 });
  const notify = (changed: string) => {
    if (basename(changed) !== name) return;
    try {
      mainWindow?.webContents.send('caffeinate-hold:changed', caffeinateUiState());
    } catch {
      // ignore
    }
    syncCaffeinateIndicator();
  };
  watcher.on('add', notify);
  watcher.on('change', notify);
  watcher.on('unlink', notify);
  app.on('will-quit', () => {
    void watcher.close();
  });
}

function stopCaffeinate(): void {
  if (!caffeinateProc) return;
  try {
    caffeinateProc.kill();
  } catch {
    // ignore
  }
  caffeinateProc = null;
}

/** Keep the Mac awake while agents run, Slack Listen, schedules, or a chat holds caffeinate. */
function syncCaffeinate(): void {
  if (process.platform !== 'darwin') {
    stopCaffeinate();
    syncCaffeinateIndicator();
    return;
  }
  const keepAwake =
    (caffeinateWhileRunningEnabled() && orch.getRuntime().running > 0) ||
    (caffeinateWhileSlackListenEnabled() && slackListenRunning) ||
    (caffeinateWhileSchedulesEnabled() && hasEnabledSchedules());
  if (keepAwake && !caffeinateProc) {
    try {
      caffeinateProc = spawn('caffeinate', ['-dimsu'], {
        stdio: 'ignore',
        detached: false,
      });
      caffeinateProc.on('exit', () => {
        caffeinateProc = null;
      });
    } catch {
      caffeinateProc = null;
    }
  } else if (!keepAwake) {
    stopCaffeinate();
  }
  syncCaffeinateIndicator();
}

function setupNotifications(): void {
  orch.on((event: OrchestratorEvent) => {
    mainWindow?.webContents.send('orchestrator:event', event);

    if (
      event.type === 'status_changed' ||
      event.type === 'turn_finished' ||
      event.type === 'turn_started' ||
      event.type === 'error'
    ) {
      syncCaffeinate();
    }

    const focused = mainWindow?.isFocused() ?? false;
    if (focused || !Notification.isSupported()) return;

    if (event.type === 'turn_finished') {
      new Notification({
        title: 'Sideboard',
        body: `Turn finished (${event.threadId.slice(0, 8)})`,
      }).show();
    }
    if (event.type === 'error') {
      new Notification({
        title: 'Sideboard error',
        body: event.message,
      }).show();
    }
  });
}

function registerIpc(): void {
  ipcMain.handle('detectAgents', () => {
    applyAppEnvironment(process.env);
    return detectAgents();
  });
  ipcMain.handle('getAgentSetupInfo', (_e, agent: AgentKind) => getAgentSetupInfo(agent));
  ipcMain.handle('installAgent', async (_e, agent: AgentKind) => {
    ensureAgentPath();
    applyAppEnvironment(process.env);
    return installAgent(agent);
  });
  ipcMain.handle('loginAgent', async (_e, agent: AgentKind) => {
    ensureAgentPath();
    applyAppEnvironment(process.env);
    return loginAgent(agent);
  });
  ipcMain.handle('getAppSettings', () => toPublicAppSettings(loadAppSettings()));
  ipcMain.handle('saveAppSettings', (_e, settings: AppSettings) => {
    const current = loadAppSettings();
    const saved = saveAppSettings({
      ...settings,
      environment: current.environment,
      integrations: {
        ...current.integrations,
        issueSource: settings.integrations?.issueSource ?? current.integrations.issueSource,
        slackClientId: settings.integrations?.slackClientId ?? current.integrations.slackClientId,
        slackListenEnabled:
          settings.integrations?.slackListenEnabled ?? current.integrations.slackListenEnabled,
      },
    });
    applyAppEnvironment(process.env, saved);
    return toPublicAppSettings(saved);
  });
  ipcMain.handle(
    'updateAppEnvironment',
    (_e, patch: Record<string, string | null | undefined>) => {
      const saved = updateAppEnvironment(patch);
      applyAppEnvironment(process.env, saved);
      return toPublicAppSettings(saved);
    },
  );
  ipcMain.handle(
    'updateClaudeSettings',
    (
      _e,
      patch: Partial<ClaudeHarnessSettings> & { executablePath?: string | null },
    ) => {
      const saved = updateClaudeSettings(patch);
      applyAppEnvironment(process.env, saved);
      return toPublicAppSettings(saved);
    },
  );
  ipcMain.handle(
    'updateAgentExecutable',
    (_e, agent: CliAgentKind, executablePath: string | null) => {
      const saved = updateAgentExecutable(agent, executablePath);
      applyAppEnvironment(process.env, saved);
      return toPublicAppSettings(saved);
    },
  );
  ipcMain.handle(
    'updateBrightsySettings',
    (
      _e,
      patch: Partial<BrightsyHarnessSettings> & {
        cloudConnectAgent?: BrightsyCloudConnectAgent | null;
      },
    ) => toPublicAppSettings(updateBrightsySettings(patch)),
  );
  ipcMain.handle('updateAdvancedSettings', (_e, patch: Partial<AdvancedAppSettings>) => {
    const saved = updateAdvancedSettings(patch);
    if (typeof patch.maxConcurrent === 'number') {
      orch.setMaxConcurrent(patch.maxConcurrent);
    }
    if (
      'caffeinateWhileRunning' in patch ||
      'caffeinateWhileSlackListen' in patch ||
      'caffeinateWhileCloudConnect' in patch ||
      'caffeinateWhileSchedules' in patch
    ) {
      syncCaffeinate();
    }
    return toPublicAppSettings(saved);
  });
  ipcMain.handle(
    'updateIntegrationsSettings',
    (
      _e,
      patch: Partial<IntegrationsSettings> & {
        linearApiKey?: string | null;
        issueSource?: IssueSource | null;
        slackAppToken?: string | null;
      },
    ) => {
      const next = { ...patch };
      // Renderer cannot clear the app-level Socket Mode token.
      if (!next.slackAppToken?.trim()) delete next.slackAppToken;
      const saved = updateIntegrationsSettings(next);
      if (next.slackAppToken || 'slackDeviceLabel' in next || 'slackDeviceId' in next) {
        stopSlackListenDaemon();
        syncSlackListenDaemon();
      }
      return toPublicAppSettings(saved);
    },
  );
  ipcMain.handle(
    'updateDefaultsSettings',
    (
      _e,
      patch: Partial<DefaultsAppSettings> & {
        agent?: AgentKind | null;
        model?: string | null;
        effort?: ThinkingEffort | null;
        fast?: boolean | null;
      },
    ) => toPublicAppSettings(updateDefaultsSettings(patch)),
  );
  ipcMain.handle('getGitHubStatus', () => getGitHubStatus());
  ipcMain.handle('getSlackWorkspaces', () => listSlackWorkspaces());
  ipcMain.handle('connectSlackToken', async (_e, token: string) => {
    await connectSlackToken(token);
    syncSlackListenDaemon();
    return listSlackWorkspaces();
  });
  let slackOauthAbort: AbortController | null = null;
  ipcMain.handle('startSlackOAuth', async () => {
    slackOauthAbort?.abort();
    const ac = new AbortController();
    slackOauthAbort = ac;
    try {
      await startSlackOAuth({
        openUrl: (url) => shell.openExternal(url),
        signal: ac.signal,
      });
      syncSlackListenDaemon();
      return listSlackWorkspaces();
    } catch (err) {
      if (isSlackOAuthCancelled(err)) {
        throw new Error('Slack sign-in cancelled');
      }
      throw err;
    } finally {
      if (slackOauthAbort === ac) slackOauthAbort = null;
    }
  });
  ipcMain.handle('cancelSlackOAuth', () => {
    slackOauthAbort?.abort();
  });
  let linearOauthAbort: AbortController | null = null;
  ipcMain.handle('startLinearOAuth', async () => {
    linearOauthAbort?.abort();
    const ac = new AbortController();
    linearOauthAbort = ac;
    try {
      const saved = await startLinearOAuth({
        openUrl: (url) => shell.openExternal(url),
        signal: ac.signal,
      });
      return toPublicAppSettings(saved);
    } catch (err) {
      if (isLinearOAuthCancelled(err)) {
        throw new Error('Linear sign-in cancelled');
      }
      throw err;
    } finally {
      if (linearOauthAbort === ac) linearOauthAbort = null;
    }
  });
  ipcMain.handle('cancelLinearOAuth', () => {
    linearOauthAbort?.abort();
  });
  ipcMain.handle('disconnectLinear', async () => {
    const saved = await disconnectLinear();
    return toPublicAppSettings(saved);
  });
  ipcMain.handle('disconnectSlackWorkspace', (_e, teamId: string) => {
    const list = disconnectSlackWorkspace(teamId);
    syncSlackListenDaemon();
    return list;
  });
  ipcMain.handle('getSlackListenStatus', () => readSlackListenStatus());
  ipcMain.handle('setSlackListen', (_e, opts: { enabled: boolean }) =>
    setSlackListen(opts),
  );
  ipcMain.handle('getCaffeinateHold', () => caffeinateUiState());
  ipcMain.handle('listIssues', async (_e, path: string) =>
    listIssues(await resolveRepoRoot(path)),
  );
  ipcMain.handle('loadHomeBoard', async (_e, opts?: { refresh?: boolean }) =>
    getHomeBoardInputs(orch.listWorkspaces(), { refresh: opts?.refresh }),
  );
  ipcMain.handle('addBoardItem', (_e, input: AddBoardPinInput) => addBoardPin(input));
  ipcMain.handle('removeBoardItem', (_e, id: string) => removeBoardPin(id));
  ipcMain.handle('getCloudConnectStatus', () => readCloudConnectStatus());
  ipcMain.handle(
    'setCloudConnect',
    (
      _e,
      opts: { enabled?: boolean; agent?: BrightsyCloudConnectAgent },
    ) => setCloudConnect(opts),
  );
  ipcMain.handle('pickClaudeExecutable', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose Claude Code executable',
      properties: ['openFile'],
      message: 'Select the Claude Code binary to use for agent turns',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('pickAgentExecutable', async (_e, agent: CliAgentKind) => {
    const labels: Record<CliAgentKind, string> = {
      claude: 'Claude Code',
      codex: 'Codex',
      opencode: 'OpenCode',
      brightsy: 'Brightsy',
    };
    const label = labels[agent] ?? agent;
    const result = await dialog.showOpenDialog({
      title: `Choose ${label} executable`,
      properties: ['openFile'],
      message: `Select the ${label} binary to use for agent turns`,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('resolveSystemClaudePath', async () => {
    const which = await run('which', ['claude'], { reject: false });
    if (which.exitCode !== 0) return null;
    const path = which.stdout.trim().split('\n')[0]?.trim();
    return path || null;
  });
  ipcMain.handle('resolveSystemAgentPath', async (_e, agent: CliAgentKind) => {
    const bins: Record<CliAgentKind, string> = {
      claude: 'claude',
      codex: 'codex',
      opencode: 'opencode',
      brightsy: 'brightsy',
    };
    const bin = bins[agent];
    if (!bin) return null;
    const which = await run('which', [bin], { reject: false });
    if (which.exitCode !== 0) return null;
    const path = which.stdout.trim().split('\n')[0]?.trim();
    return path || null;
  });
  ipcMain.handle('openClaudeUserSettings', async () => {
    const path = claudeUserSettingsPath();
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '{}\n', 'utf8');
    }
    const err = await shell.openPath(path);
    if (err) throw new Error(err);
  });
  ipcMain.handle('listBrightsyChatTargets', () => listBrightsyChatTargets());
  ipcMain.handle('listCursorModels', () => {
    applyAppEnvironment(process.env);
    return listCursorModels();
  });
  ipcMain.handle('listCodexModels', () => {
    ensureAgentPath();
    applyAppEnvironment(process.env);
    return listCodexModels();
  });
  ipcMain.handle('listOpencodeModels', () => {
    ensureAgentPath();
    applyAppEnvironment(process.env);
    return listOpencodeModels();
  });
  ipcMain.handle('getBrightsySession', () => getBrightsySession());
  ipcMain.handle('getBrightsyCmsAuth', async () => {
    try {
      await ensureBrightsyLocalConfigFresh();
      await ensureConnectedBrightsyTeamTokens();
      const cfg = loadBrightsyConfig();
      const session = await getBrightsySession();
      if (!session.connected || !cfg.access_token || !cfg.account_id) {
        return {
          endpoint: cfg.endpoint || session.endpoint || 'https://brightsy.ai',
          accessToken: null,
          accountId: null,
          accountSlug: null,
          reason: session.reason || 'not logged in — run `brightsy login`',
        };
      }
      return {
        endpoint: (cfg.endpoint || session.endpoint || 'https://brightsy.ai').replace(/\/$/, ''),
        accessToken: cfg.access_token,
        accountId: cfg.account_id,
        accountSlug: session.accountSlug,
      };
    } catch (err) {
      return {
        endpoint: 'https://brightsy.ai',
        accessToken: null,
        accountId: null,
        accountSlug: null,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  });
  ipcMain.handle('switchBrightsyAccount', (_e, accountIdOrSlug: string) =>
    switchBrightsyAccount(accountIdOrSlug),
  );
  ipcMain.handle('connectBrightsyTeam', async (_e, accountIdOrSlug: string) => {
    await connectBrightsyTeam(accountIdOrSlug);
    return getBrightsySession();
  });
  ipcMain.handle('disconnectBrightsyTeam', async (_e, accountIdOrSlug: string) => {
    await disconnectBrightsyTeam(accountIdOrSlug);
    return getBrightsySession();
  });
  ipcMain.handle(
    'listBranches',
    async (_e, path: string, opts?: { unmergedOnly?: boolean }) =>
      listBranches(await resolveRepoRoot(path), opts),
  );
  ipcMain.handle('listPrs', async (_e, path: string) => listPrs(await resolveRepoRoot(path)));
  ipcMain.handle('listLinearIssues', (_e, agent: AgentKind, path: string) =>
    listLinearIssues(agent, path),
  );
  ipcMain.handle('resolveRepoRoot', (_e, cwd: string) => resolveRepoRoot(cwd));
  ipcMain.handle('getThreads', (_e, includeArchived?: boolean) =>
    orch.getThreads(Boolean(includeArchived)),
  );
  ipcMain.handle('getThread', (_e, id: string) => orch.getThread(id));
  ipcMain.handle('getRuntime', () => orch.getRuntime());
  ipcMain.handle('setMaxConcurrent', (_e, n: number) => {
    orch.setMaxConcurrent(n);
    updateAdvancedSettings({ maxConcurrent: n });
  });
  ipcMain.handle('createThread', async (_e, input: CreateThreadInput) => {
    await orch.reconcile(input.repoPath);
    return orch.createThread(input);
  });
  ipcMain.handle('createChatTab', (_e, input) => orch.createChatTab(input));
  ipcMain.handle('requestReview', (_e, ref: string) => orch.requestReview(ref));
  ipcMain.handle('forkChatTab', (_e, input) => orch.forkChatTab(input));
  ipcMain.handle('forkThreadWorktree', async (_e, input) => {
    const source = orch.getThread(input.threadId);
    if (source) await orch.reconcile(source.repoPath);
    return orch.forkThreadWorktree(input);
  });
  ipcMain.handle('renameThread', (_e, ref: string, title: string) =>
    orch.renameThread(ref, title),
  );
  ipcMain.handle('setAttachments', (_e, ref: string, attachments) =>
    orch.setAttachments(ref, attachments),
  );
  ipcMain.handle(
    'attachComposerFiles',
    (
      _e,
      ref: string,
      opts: { absolutePaths?: string[]; relativePaths?: string[] },
    ) => orch.attachComposerFiles(ref, opts ?? {}),
  );
  ipcMain.handle('listWorktreeChats', (_e, ref: string) => orch.listWorktreeChats(ref));
  ipcMain.handle('listWorkspaces', () => {
    try {
      return orch.listWorkspaces();
    } catch (err) {
      console.error('listWorkspaces failed', err);
      return [];
    }
  });
  ipcMain.handle('addWorkspace', async (_e, path: string) => orch.addWorkspace(path));
  ipcMain.handle('removeWorkspace', (_e, path: string) => {
    orch.removeWorkspace(path);
  });
  ipcMain.handle('adopt', (_e, input: AdoptInput) => orch.adopt(input));
  ipcMain.handle('listConductor', () => orch.listConductor());
  ipcMain.handle('adoptFromConductor', (_e, id: string) => orch.adoptFromConductor(id));
  ipcMain.handle('sendToThread', (_e, ref: string, prompt: string) => orch.send(ref, prompt));
  ipcMain.handle('editQueuedMessage', (_e, ref: string, index: number, text: string) =>
    orch.editQueuedMessage(ref, index, text),
  );
  ipcMain.handle('removeQueuedMessage', (_e, ref: string, index: number) =>
    orch.removeQueuedMessage(ref, index),
  );
  ipcMain.handle('sendQueuedMessageNow', (_e, ref: string, index: number) =>
    orch.sendQueuedMessageNow(ref, index),
  );
  ipcMain.handle('setAutonomy', (_e, ref: string, autonomy: Autonomy) =>
    orch.setAutonomy(ref, autonomy),
  );
  ipcMain.handle('setThreadOptions', (_e, ref: string, patch: ThreadOptionsPatch) =>
    orch.setThreadOptions(ref, patch),
  );
  ipcMain.handle('fanOut', (_e, refs: string[], prompt: string) => orch.fanOut(refs, prompt));
  ipcMain.handle(
    'startOrchestration',
    (
      _e,
      opts: {
        goal: string;
        agent: AgentKind;
        repoPath?: string;
        autonomy?: Autonomy;
        model?: string | null;
        effort?: ThinkingEffort;
        fast?: boolean;
        planMode?: boolean;
        attachments?: ThreadAttachment[];
      },
    ) => startOrchestration(opts),
  );
  ipcMain.handle('listSchedules', () => listSchedules());
  ipcMain.handle(
    'createSchedule',
    (_e, input: Omit<CreateScheduledTaskInput, 'createdBy'>) => {
      const row = createSchedule({ ...input, createdBy: 'ui' });
      syncCaffeinate();
      return row;
    },
  );
  ipcMain.handle(
    'updateSchedule',
    (_e, id: string, patch: UpdateScheduledTaskPatch) => {
      const row = updateSchedule(id, patch);
      syncCaffeinate();
      return row;
    },
  );
  ipcMain.handle('deleteSchedule', (_e, id: string) => {
    deleteSchedule(id);
    syncCaffeinate();
  });
  ipcMain.handle('runSchedule', async (_e, id: string) => {
    const row = await fireSchedule(id);
    syncCaffeinate();
    return row;
  });
  ipcMain.handle(
    'createGlobalChat',
    (
      _e,
      opts: {
        title?: string;
        agent: AgentKind;
        autonomy?: Autonomy;
        model?: string | null;
        effort?: ThinkingEffort;
        fast?: boolean;
        planMode?: boolean;
        attachments?: ThreadAttachment[];
      },
    ) => createGlobalChat(opts),
  );
  ipcMain.handle('ensureCloudCoordinator', (_e, agent: AgentKind) =>
    ensureCloudCoordinator(agent),
  );
  ipcMain.handle('stopThread', (_e, ref: string) =>
    orch.stop(ref, { clearQueue: false }),
  );
  ipcMain.handle(
    'getDiff',
    (
      _e,
      ref: string,
      opts?: {
        scope?: DiffScope;
        commitSha?: string | null;
        base?: string;
        includePatches?: boolean;
        includeMeta?: boolean;
        includeUntracked?: boolean;
        path?: string;
      },
    ) => orch.diff(ref, opts),
  );
  ipcMain.handle('initializeGit', (_e, ref: string) => orch.initializeGit(ref));
  ipcMain.handle('getPrChecks', (_e, ref: string) => orch.getPrChecks(ref));
  ipcMain.handle('getPrMeta', (_e, ref: string) => orch.getPrMeta(ref));
  ipcMain.handle('getPrStack', (_e, ref: string) => orch.getPrStack(ref));
  ipcMain.handle(
    'openPrStackLayers',
    (_e, ref: string, opts?: { layer?: number }) => orch.openPrStackLayers(ref, opts),
  );
  ipcMain.handle(
    'addStackLayer',
    (_e, ref: string, branchName: string, opts?: { title?: string }) =>
      orch.addStackLayer(ref, branchName, opts),
  );
  ipcMain.handle(
    'initStackFromThread',
    (_e, ref: string, opts?: { additionalBranches?: string[]; base?: string }) =>
      orch.initStackFromThread(ref, opts),
  );
  ipcMain.handle('createPrStack', (_e, input) => orch.createPrStack(input));
  ipcMain.handle('getPrDetails', (_e, ref: string) => orch.getPrDetails(ref));
  ipcMain.handle('listFiles', (_e, ref: string) => orch.listFiles(ref));
  ipcMain.handle('readFile', (_e, ref: string, relativePath: string) =>
    orch.readFile(ref, relativePath),
  );
  ipcMain.handle('readFileForUpload', (_e, ref: string, relativePath: string) =>
    orch.readFileForUpload(ref, relativePath),
  );
  ipcMain.handle('writeFile', (_e, ref: string, relativePath: string, content: string) =>
    orch.writeFile(ref, relativePath, content),
  );
  ipcMain.handle('watchOpenFile', (_e, ref: string, relativePath: string) =>
    startOpenFileWatcher(ref, relativePath),
  );
  ipcMain.handle('unwatchOpenFile', () => stopOpenFileWatcher());
  ipcMain.handle('listSkills', (_e, ref: string) => orch.listSkills(ref));
  ipcMain.handle(
    'openInEditor',
    async (_e, ref: string, editor?: string, relativePath?: string) => {
      const t = orch.getThread(ref);
      if (!t) throw new Error(`Thread not found: ${ref}`);
      if (relativePath && (relativePath.includes('..') || relativePath.startsWith('/'))) {
        throw new Error('Invalid path');
      }
      const target = relativePath ? join(t.worktreePath, relativePath) : t.worktreePath;
      const cmd = editor ?? process.env.SIDEBOARD_EDITOR ?? 'cursor';
      spawn(cmd, [target], { detached: true, stdio: 'ignore' }).unref();
    },
  );
  ipcMain.handle(
    'openWorktree',
    async (_e, ref: string, target: 'finder' | 'cursor' | 'code' | 'xcode' | 'terminal' | 'datagrip') => {
      const t = orch.getThread(ref);
      if (!t) throw new Error(`Thread not found: ${ref}`);
      const p = t.worktreePath;
      if (target === 'finder') {
        spawn('open', [p], { detached: true, stdio: 'ignore' }).unref();
        return;
      }
      if (target === 'terminal') {
        spawn('open', ['-a', 'Terminal', p], { detached: true, stdio: 'ignore' }).unref();
        return;
      }
      if (target === 'xcode') {
        spawn('open', ['-a', 'Xcode', p], { detached: true, stdio: 'ignore' }).unref();
        return;
      }
      if (target === 'datagrip') {
        spawn('open', ['-a', 'DataGrip', p], { detached: true, stdio: 'ignore' }).unref();
        return;
      }
      const cmd = target === 'code' ? 'code' : 'cursor';
      spawn(cmd, [p], { detached: true, stdio: 'ignore' }).unref();
    },
  );
  ipcMain.handle('runDevScript', (_e, ref: string, scriptName?: string) =>
    orch.startDev(ref, scriptName),
  );
  ipcMain.handle('stopDevScript', (_e, ref: string, scriptName?: string) => {
    orch.stopDev(ref, scriptName);
  });
  ipcMain.handle('listRunScripts', (_e, ref: string) =>
    orch.listThreadRunScripts(ref),
  );
  ipcMain.handle('getActiveRuns', (_e, ref: string) => orch.getActiveRuns(ref));
  ipcMain.handle(
    'applyIntoMain',
    (
      _e,
      ref: string,
      opts?: { method?: 'merge' | 'cherry-pick'; targetBranch?: string },
    ) => orch.applyIntoMain(ref, opts),
  );
  ipcMain.handle('cloneRepo', (_e, url: string, name?: string) =>
    orch.cloneRepo(url, name),
  );
  ipcMain.handle('listOrphanWorktrees', (_e, repoPath?: string) =>
    orch.listOrphanWorktrees(repoPath),
  );
  ipcMain.handle(
    'cleanupOrphans',
    (
      _e,
      opts?: { dryRun?: boolean; maxCount?: number; repoPath?: string },
    ) => orch.cleanupOrphans(opts),
  );
  ipcMain.handle(
    'bestOfN',
    (
      _e,
      opts: {
        prompt: string;
        agents: Array<'claude' | 'codex' | 'opencode' | 'brightsy' | 'cursor'>;
        repoPath: string;
        sourceType?: 'branch' | 'pr' | 'ticket';
        sourceRef?: string;
        title?: string;
      },
    ) => orch.bestOfN(opts),
  );
  ipcMain.handle('attachThread', async (_e, ref: string) => {
    const cmd = await orch.attachCommand(ref);
    return { file: cmd.file, args: cmd.args, cwd: cmd.cwd };
  });
  ipcMain.handle(
    'terminal:start',
    async (_e, ref: string, cols?: number, rows?: number) => {
      const { startTerminalSession } = await import('./terminal.js');
      return startTerminalSession(orch, ref, cols, rows);
    },
  );
  ipcMain.handle(
    'terminal:attach',
    async (_e, ref: string, cols?: number, rows?: number) => {
      const { startTerminalSession } = await import('./terminal.js');
      const cmd = await orch.attachCommand(ref);
      return startTerminalSession(orch, ref, cols, rows, {
        command: cmd.file,
        args: cmd.args,
      });
    },
  );
  ipcMain.handle('terminal:write', (_e, id: string, data: string) => {
    return import('./terminal.js').then((m) => m.writeTerminal(id, data));
  });
  ipcMain.handle(
    'terminal:resize',
    (_e, id: string, cols: number, rows: number) => {
      return import('./terminal.js').then((m) => m.resizeTerminal(id, cols, rows));
    },
  );
  ipcMain.handle('terminal:kill', (_e, id: string) => {
    return import('./terminal.js').then((m) => m.killTerminal(id));
  });
  ipcMain.handle('previewLand', (_e, ref: string) => orch.previewLand(ref));
  ipcMain.handle(
    'confirmLand',
    (_e, ref: string, opts?: { draft?: boolean; web?: boolean }) =>
      orch.confirmLand(ref, opts),
  );
  ipcMain.handle('mergePr', (_e, ref: string) => orch.mergePr(ref));
  ipcMain.handle(
    'askGit',
    (
      _e,
      ref: string,
      action:
        | 'commit-push'
        | 'create-draft'
        | 'create-web'
        | 'resolve-conflicts'
        | 'merge',
    ) => orch.askGit(ref, action),
  );
  ipcMain.handle('archiveThread', (_e, ref: string) => orch.archive(ref));
  ipcMain.handle('purgeThread', (_e, ref: string, opts?: { deleteBranch?: boolean }) =>
    orch.purge(ref, opts),
  );
  ipcMain.handle('restoreThread', (_e, ref: string) => orch.restore(ref));
  ipcMain.handle('getRepoPath', () => repoPath);
  ipcMain.handle('setRepoPath', async (_e, path: string) => {
    const trimmed = typeof path === 'string' ? path.trim() : '';
    if (!trimmed || trimmed === '/') {
      repoPath = '';
      return repoPath;
    }
    repoPath = await resolveRepoRoot(trimmed);
    await orch.reconcile(repoPath);
    return repoPath;
  });
  ipcMain.handle(
    'hasConductorHook',
    (_e, worktreePath: string, repoPath?: string | null) =>
      hasConductorHook(worktreePath, repoPath),
  );
  ipcMain.handle(
    'getRepoSetupInfo',
    (_e, worktreePath: string, repoPath?: string | null) =>
      getRepoSetupInfo(worktreePath, repoPath),
  );
  ipcMain.handle('runSetup', (_e, ref: string) => orch.runSetup(ref));
  ipcMain.handle('pickRepoPath', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    repoPath = await resolveRepoRoot(result.filePaths[0]);
    await orch.addWorkspace(repoPath);
    await orch.reconcile(repoPath);
    return repoPath;
  });
  ipcMain.handle('pickFiles', async (_e, threadRef?: string | null) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    if (typeof threadRef === 'string' && threadRef.trim()) {
      return orch.attachComposerFiles(threadRef, { absolutePaths: result.filePaths });
    }
    return result.filePaths.map((p) => attachmentFromAbsolutePath(p));
  });
  ipcMain.handle('attachmentsFromPaths', (_e, absolutePaths: string[]) => {
    const paths = Array.isArray(absolutePaths)
      ? absolutePaths.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : [];
    return paths.map((p) => attachmentFromAbsolutePath(p));
  });
  ipcMain.handle(
    'attachmentsFromBuffers',
    (_e, buffers: Array<{ name: string; dataBase64: string }>) => {
      const list = Array.isArray(buffers) ? buffers : [];
      return attachmentsFromBuffers(list);
    },
  );
  ipcMain.handle('installUpdate', () => {
    autoUpdater.quitAndInstall();
  });
  ipcMain.handle('checkForUpdates', () => checkForUpdatesManual());
  ipcMain.handle('getAppVersion', () => app.getVersion());
  ipcMain.handle('openExternal', async (_e, url: string) => {
    if (typeof url !== 'string' || !url.trim()) return;
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      return;
    }
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return;
    await shell.openExternal(parsed.href);
  });

  ipcMain.handle(
    'urlPreview:show',
    (_e, opts: { url: string; bounds: UrlPreviewBounds }) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      showUrlPreview(mainWindow, opts.url, opts.bounds);
    },
  );
  ipcMain.handle('urlPreview:setBounds', (_e, bounds: UrlPreviewBounds) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    setUrlPreviewBounds(mainWindow, bounds);
  });
  ipcMain.handle('urlPreview:navigate', (_e, url: string) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    navigateUrlPreview(mainWindow, url);
  });
  ipcMain.handle('urlPreview:reload', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    reloadUrlPreview(mainWindow);
  });
  ipcMain.handle('urlPreview:hide', () => {
    hideUrlPreview(mainWindow);
  });
}

app.whenReady().then(async () => {
  // Chromium networking — Node undici `fetch` fails as "fetch failed" on many VPNs.
  setHttpFetchImpl(net.fetch.bind(net) as typeof fetch);
  try {
    initDesktopSecretVault();
  } catch (err) {
    console.warn(
      'Secret vault init skipped:',
      err instanceof Error ? err.message : err,
    );
  }
  // GUI apps get a stripped PATH; make sure `claude` / friends resolve.
  ensureAgentPath();
  if (app.isPackaged) {
    void registerPackagedUserMcpClients().catch((err) => {
      console.warn(
        'User MCP registration skipped:',
        err instanceof Error ? err.message : err,
      );
    });
  }
  // Keychain is OK here (app start). Later agent turns reuse ~/.sideboard-git-auth.
  void warmGithubAgentAuth({ force: true }).catch((err) => {
    console.warn(
      'GitHub agent auth warm skipped:',
      err instanceof Error ? err.message : err,
    );
  });
  // Conductor-style Settings → Environment (e.g. CURSOR_API_KEY).
  applyAppEnvironment(process.env);
  if (process.platform === 'darwin') {
    app.setName('Sideboard');
  }
  orch.setMaxConcurrent(maxConcurrentAgents());
  // MCP/CLI send_to_thread must not spawn worktree turns in the stdio child —
  // the board adopts persisted queues so live IPC reaches the chat UI.
  claimDesktopHost();
  applyDockIcon();
  bindArtifactPreviewProtocol();
  registerIpc();
  setupNotifications();
  setupStoreWatcher();
  setupSchedulesWatcher();
  setupCaffeinateHoldWatcher();
  setupUpdater();
  // Poll slack_post reply watches in main (inject into posting chat).
  const pollSlackOutbound = () => {
    void pollSlackOutboundWatches().catch(() => undefined);
  };
  pollSlackOutbound();
  setInterval(pollSlackOutbound, 12_000);
  setupApplicationMenu(() => mainWindow);
  try {
    const root = await resolveRepoRoot(process.cwd());
    // Packaged launches often have cwd `/`, which is not a real project.
    if (root && root !== '/') {
      repoPath = root;
      await orch.reconcile(repoPath, { reclaimStaleTurns: true });
      try {
        await orch.addWorkspace(repoPath);
      } catch {
        // cwd may not be a usable workspace
      }
    }
  } catch {
    // Leave repoPath empty when cwd is not inside a git repo (typical for Dock launches).
  }
  armSchedules();
  syncCaffeinate();
  orch.listWorkspaces();
  createWindow();
  if (mainWindow) setupTsServer(mainWindow);
  syncSlackListenDaemon();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (mainWindow) setupTsServer(mainWindow);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  try {
    releaseDesktopHost();
  } catch {
    // ignore
  }
  destroyUrlPreview();
  stopCloudConnectDaemon();
  stopSlackListenDaemon();
  stopCaffeinate();
  destroyCaffeinateTray();
  try {
    if (process.platform === 'darwin') app.dock?.setBadge('');
  } catch {
    // ignore
  }
  try {
    setCaffeinateHold(false);
  } catch {
    // ignore
  }
  void stopOpenFileWatcher();
  void closeTsServer();
});
