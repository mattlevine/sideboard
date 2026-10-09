import './ignore-epipe';
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
import { setupTextContextMenu } from './text-context-menu';
import { askMicrophoneAccess, setupMicrophonePermissions } from './microphone-access';
import {
  pushLiveSpeechPcm,
  startLiveSpeechDictate,
  stopLiveSpeechDictate,
  transcribeWavFile,
} from './speech-dictate';
import { formatUpdaterCheckError } from './updater-error';
import {
  bindPhoneOpenFile,
  showPhoneFile,
  bindPhoneOpenArtifact,
  showPhoneArtifact,
  bindRemoteHostActivity,
  isRemoteHostRunning,
  readRemoteStatus,
  refreshRemoteDeviceLabel,
  requestRemotePairing,
  restartRemoteHost,
  signInRemoteAccount,
  signOutRemoteAccount,
  startRemoteHost,
} from './remote-host-daemon';
import { initDesktopSecretVault } from './secret-vault';
import {
  caffeinateIndicatorReasons,
  caffeinateIndicatorTooltip,
  caffeinateTrayPng,
  paintCaffeinateDockBadge,
} from './caffeinate-indicator';
import {
  MAC_OPEN,
  execMacOpen,
  finderLaunchCommands,
  finderRevealTarget,
  isWorktreeOpenerId,
  listWorktreeOpenerBundles,
  openerIdForEditor,
  openWorktreeFolder,
  pngDataUrlFromIcnsFile,
  spawnDetached,
  toWorktreeOpener,
} from './open-worktree';

// Must run before app.ready so artifact iframes can load outside renderer CSP.
registerArtifactPreviewScheme();

import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
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
  getOrchestrator,
  installAgent,
  listBranches,
  listBrightsyChatTargets,
  listCursorModels,
  listCodexModels,
  listOpencodeModels,
  getClaudePlanUsage,
  getBrightsySession,
  switchBrightsyAccount,
  connectBrightsyTeam,
  disconnectBrightsyTeam,
  listPrs,
  listLinearIssues,
  listIssues,
  type ListIssuesOptions,
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
  startAbleTimeOAuth,
  isAbleTimeOAuthCancelled,
  disconnectLinear,
  disconnectAbleTimeConnection,
  verifyAbleTimeConnection,
  connectOptionalService,
  disconnectOptionalService,
  detectOptionalServiceClis,
  installOptionalServiceCli,
  type OptionalServiceId,
  ensureAbleTimeTask,
  toAbleTimeIssueInfo,
  resolveSlackListenMode,
  slackAppLevelToken,
  slackRelayUrl,
  hasBakedSlackOAuth,
  followUpBehavior,
  ensureSlackDeviceIdentity,
  loadAppSettings,
  toPublicAppSettings,
  loadBrightsyConfig,
  ensureBrightsyLocalConfigFresh,
  ensureConnectedBrightsyTeamTokens,
  loginAgent,
  loginManagedAccount,
  maxConcurrentAgents,
  resolveRepoRoot,
  ensureWorkspace,
  run,
  runCloudConnect,
  saveAppSettings,
  setHttpFetchImpl,
  applySystemCaEnv,
  materializeSystemCaBundle,
  startOrchestration,
  createGlobalChat,
  ensureCloudCoordinator,
  hasConductorHook,
  getRepoSetupInfo,
  threadsDir,
  isThreadRecordFile,
  isSelfWrittenRecord,
  isUnclaimedRunScriptRequest,
  readThread,
  invalidateThreadListCache,
  invalidateThreadRecord,
  slimThreadForUiList,
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
  updateProjectProfileSettings,
  updateIntegrationsSettings,
  addManagedAccount,
  selectManagedAccount,
  removeManagedAccount,
  renameManagedAccount,
  importAgentDoneCustomSound,
  clearAgentDoneCustomSoundFile,
  readAgentDoneCustomSound,
  AGENT_DONE_CUSTOM_SOUND_EXTENSIONS,
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
  type DefaultsSettingsPatch,
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
  type RelayAccountProvider,
} from '@sideboard-ai/core';
import { closeTsServer, setupTsServer } from './tsserver';
import { startDesktopHost, stopDesktopHost } from './desktop-host';

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
{
  const archiveThread = orch.archive.bind(orch);
  const purgeThread = orch.purge.bind(orch);
  // Terminal teardown runs after archive/purge settle: the orchestrator
  // serializes sibling closes per worktree, so only the last one sees an
  // empty live list and kills the shared shell PTY.
  orch.archive = async (ref: string) => {
    const { killTerminalsAfterThreadTeardown, threadWorktreePathForTeardown } = await import(
      './terminal.js'
    );
    const worktreePath = threadWorktreePathForTeardown(orch, ref);
    try {
      return await archiveThread(ref);
    } finally {
      killTerminalsAfterThreadTeardown(ref, worktreePath);
    }
  };
  orch.purge = async (ref: string, opts?: { deleteBranch?: boolean }) => {
    const { killTerminalsAfterThreadTeardown, threadWorktreePathForTeardown } = await import(
      './terminal.js'
    );
    const worktreePath = threadWorktreePathForTeardown(orch, ref);
    try {
      return await purgeThread(ref, opts);
    } finally {
      killTerminalsAfterThreadTeardown(ref, worktreePath);
    }
  };
}
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

function syncSlackListenDaemon(): SlackListenStatus {
  stopSlackListenDaemon();
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

const openerIconCache = new Map<string, string | null>();

function iconDataUrlForApp(iconPath: string | null): string | null {
  if (!iconPath) return null;
  if (openerIconCache.has(iconPath)) return openerIconCache.get(iconPath) ?? null;
  const url = pngDataUrlFromIcnsFile(iconPath);
  openerIconCache.set(iconPath, url);
  return url;
}

/**
 * Reveal in Finder via Launch Services with Electron env stripped.
 * `open -a Finder <dir>` is a no-op; `showItemInFolder` often stays behind this window.
 */
async function revealWorktreeInFinder(folder: string): Promise<void> {
  if (!folder || !existsSync(folder)) {
    throw new Error(`Worktree folder is missing:\n${folder}`);
  }
  let resolved = folder;
  try {
    resolved = realpathSync(folder);
  } catch {
    resolved = folder;
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(resolved);
  } catch {
    entries = [];
  }
  const reveal = finderRevealTarget(resolved, entries);
  shell.showItemInFolder(reveal);
  for (const { file, args } of finderLaunchCommands(reveal)) {
    await execMacOpen(file, args);
  }
  mainWindow?.blur();
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
    slackListenRunning: slackListenRunning || isRemoteHostRunning(),
    whileSchedules: caffeinateWhileSchedulesEnabled(),
    schedulesEnabled: hasEnabledSchedules(),
  });
  return { ...hold, appCaffeinated: reasons.length > 0 };
}

let dockUnreadCount = 0;

function applyDockUnreadBadge(): void {
  if (process.platform !== 'darwin' || !app.dock) return;
  try {
    app.dock.setBadge(dockUnreadCount > 0 ? String(dockUnreadCount) : '');
  } catch {
    // ignore
  }
}

function syncCaffeinateIndicator(): void {
  const state = caffeinateUiState();
  const reasons = caffeinateIndicatorReasons({
    holdHeld: state.held,
    whileRunning: caffeinateWhileRunningEnabled(),
    agentsRunning: orch.getRuntime().running,
    whileSlackListen: caffeinateWhileSlackListenEnabled(),
    slackListenRunning: slackListenRunning || isRemoteHostRunning(),
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
    applyDockUnreadBadge();
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

  setupTextContextMenu(mainWindow);

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
      message: formatUpdaterCheckError(err).detail,
    });
  });
}

function setupStoreWatcher(): void {
  const dir = threadsDir();
  const watcher = watch(dir, { ignoreInitial: true, depth: 0 });
  let adoptTimer: ReturnType<typeof setTimeout> | null = null;
  let notifyTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingRecordIds = new Set<string>();
  const flushNotify = () => {
    notifyTimer = null;
    // Records this process wrote last are already coherent in the store cache
    // — only foreign (or deleted) records need a cache drop and a
    // queue / run-script adoption pass. Check before invalidating: the
    // invalidation forgets the self-write marker. A self-written record that
    // still carries a queue or unclaimed `runScriptRequest` is the one race
    // worth paying for: an MCP enqueue landed inside this debounce window.
    let foreign = pendingRecordIds.size === 0;
    if (pendingRecordIds.size > 0) {
      for (const id of pendingRecordIds) {
        const record = readThread(id);
        if (
          isSelfWrittenRecord(id) &&
          !record?.queue.length &&
          !isUnclaimedRunScriptRequest(record?.runScriptRequest)
        ) {
          continue;
        }
        foreign = true;
        invalidateThreadRecord(id);
      }
      pendingRecordIds.clear();
    } else {
      invalidateThreadListCache();
    }
    mainWindow?.webContents.send('threads:changed');
    if (!foreign) return;
    // MCP stdio (separate process) enqueues via send_to_chat / run_dev_script;
    // when that child exits mid-wait, queues and runScriptRequest stay on disk.
    // Adopt them into the desktop drain / startDev.
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
    const id = basename(changed).replace(/\.json$/, '');
    if (id) pendingRecordIds.add(id);
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
    (caffeinateWhileSlackListenEnabled() && (slackListenRunning || isRemoteHostRunning())) ||
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
  ipcMain.handle(
    'addManagedAccount',
    (_e, kind: 'claude' | 'codex', label: string) =>
      toPublicAppSettings(addManagedAccount(kind, label)),
  );
  ipcMain.handle(
    'selectManagedAccount',
    (_e, kind: 'claude' | 'codex', accountId: string | null) =>
      toPublicAppSettings(selectManagedAccount(kind, accountId)),
  );
  ipcMain.handle('removeManagedAccount', (_e, id: string) =>
    toPublicAppSettings(removeManagedAccount(id)),
  );
  ipcMain.handle('renameManagedAccount', (_e, id: string, label: string) =>
    toPublicAppSettings(renameManagedAccount(id, label)),
  );
  ipcMain.handle('loginManagedAccount', async (_e, id: string) => {
    ensureAgentPath();
    applyAppEnvironment(process.env);
    return loginManagedAccount(id);
  });
  ipcMain.handle('setDockBadge', (_e, count: number) => {
    dockUnreadCount = Math.max(0, Math.floor(Number(count) || 0));
    applyDockUnreadBadge();
  });
  ipcMain.handle('getAppSettings', () => toPublicAppSettings(loadAppSettings()));
  ipcMain.handle('saveAppSettings', (_e, settings: AppSettings) => {
    const current = loadAppSettings();
    const saved = saveAppSettings({
      ...settings,
      environment: current.environment,
      accounts: settings.accounts ?? current.accounts,
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
  ipcMain.handle('importAgentDoneSound', async () => {
    const filters = [
      {
        name: 'Audio',
        extensions: AGENT_DONE_CUSTOM_SOUND_EXTENSIONS.map((ext) => ext.replace(/^\./, '')),
      },
    ];
    const opts = {
      title: 'Choose agent done sound',
      properties: ['openFile' as const],
      filters,
      message: 'Select an audio file to play when an agent turn finishes',
    };
    // Attach to the main window so cancel always settles (detached dialogs can hang).
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || !result.filePaths[0]) return null;
    const imported = importAgentDoneCustomSound(result.filePaths[0]);
    const saved = updateAdvancedSettings({
      agentDoneSound: 'custom',
      agentDoneCustomSoundName: imported.name,
    });
    return toPublicAppSettings(saved);
  });
  ipcMain.handle('clearAgentDoneCustomSound', () => {
    clearAgentDoneCustomSoundFile();
    const current = loadAppSettings();
    const saved = updateAdvancedSettings({
      agentDoneCustomSoundName: '',
      ...(current.advanced.agentDoneSound === 'custom'
        ? { agentDoneSound: 'none' as const }
        : {}),
    });
    return toPublicAppSettings(saved);
  });
  ipcMain.handle('getAgentDoneCustomSound', () => {
    const settings = loadAppSettings();
    return readAgentDoneCustomSound(settings.advanced.agentDoneCustomSoundName);
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
      if ('slackDeviceId' in next) {
        restartRemoteHost();
      } else if ('slackDeviceLabel' in next) {
        refreshRemoteDeviceLabel();
      }
      return toPublicAppSettings(saved);
    },
  );
  ipcMain.handle(
    'updateDefaultsSettings',
    (_e, patch: DefaultsSettingsPatch) =>
      toPublicAppSettings(updateDefaultsSettings(patch)),
  );
  ipcMain.handle(
    'updateProjectProfileSettings',
    (
      _e,
      repoPath: string,
      patch: { notes?: string | null; reviewLabel?: string | null },
    ) => toPublicAppSettings(updateProjectProfileSettings(repoPath, patch)),
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
  ipcMain.handle(
    'connectAbleTime',
    async (_e, input: { token: string; host?: string | null }) => {
      await verifyAbleTimeConnection(input);
      return toPublicAppSettings(loadAppSettings());
    },
  );
  let abletimeOauthAbort: AbortController | null = null;
  ipcMain.handle('startAbleTimeOAuth', async (_e, host?: string | null) => {
    abletimeOauthAbort?.abort();
    const ac = new AbortController();
    abletimeOauthAbort = ac;
    try {
      const saved = await startAbleTimeOAuth({
        openUrl: (url) => shell.openExternal(url),
        signal: ac.signal,
        host,
      });
      return toPublicAppSettings(saved);
    } catch (err) {
      if (isAbleTimeOAuthCancelled(err)) {
        throw new Error('AbleTime sign-in cancelled');
      }
      throw err;
    } finally {
      if (abletimeOauthAbort === ac) abletimeOauthAbort = null;
    }
  });
  ipcMain.handle('cancelAbleTimeOAuth', () => {
    abletimeOauthAbort?.abort();
  });
  ipcMain.handle('disconnectAbleTime', () =>
    toPublicAppSettings(disconnectAbleTimeConnection()),
  );
  ipcMain.handle(
    'connectOptionalService',
    async (
      _e,
      input: { id: OptionalServiceId; token: string; host?: string | null },
    ) => {
      const saved = await connectOptionalService(input);
      return toPublicAppSettings(saved);
    },
  );
  ipcMain.handle('disconnectOptionalService', (_e, id: OptionalServiceId) =>
    toPublicAppSettings(disconnectOptionalService(id)),
  );
  ipcMain.handle('detectOptionalServiceClis', () => {
    ensureAgentPath();
    applyAppEnvironment(process.env);
    return detectOptionalServiceClis();
  });
  ipcMain.handle('installOptionalServiceCli', async (_e, id: OptionalServiceId) => {
    ensureAgentPath();
    applyAppEnvironment(process.env);
    return installOptionalServiceCli(id);
  });
  ipcMain.handle(
    'ensureAbleTimeTask',
    async (
      _e,
      input: { title: string; description?: string; projectId?: string },
    ) => {
      const task = await ensureAbleTimeTask(input);
      return { ...toAbleTimeIssueInfo(task), created: task.created };
    },
  );
  ipcMain.handle('disconnectSlackWorkspace', (_e, teamId: string) => {
    const list = disconnectSlackWorkspace(teamId);
    syncSlackListenDaemon();
    return list;
  });
  ipcMain.handle('getSlackListenStatus', () => readSlackListenStatus());
  ipcMain.handle('getRemoteStatus', () => readRemoteStatus());
  ipcMain.handle('requestRemotePairingCode', () => requestRemotePairing());
  ipcMain.handle('startRemoteAccountLogin', (_e, provider: RelayAccountProvider) =>
    signInRemoteAccount(provider, (url) => shell.openExternal(url)),
  );
  ipcMain.handle('disconnectRemoteAccount', () => signOutRemoteAccount());
  ipcMain.handle('setSlackListen', (_e, opts: { enabled: boolean }) =>
    setSlackListen(opts),
  );
  ipcMain.handle('getCaffeinateHold', () => caffeinateUiState());
  ipcMain.handle('listIssues', async (_e, path: string, opts?: ListIssuesOptions) =>
    listIssues(await resolveRepoRoot(path), opts),
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
  ipcMain.handle('getClaudeUsage', (_e, refresh?: boolean) => {
    applyAppEnvironment(process.env);
    const settings = loadAppSettings();
    const active = settings.accounts.accounts.find(
      (a) => a.id === settings.accounts.activeClaudeAccountId && a.kind === 'claude',
    );
    return getClaudePlanUsage({
      force: Boolean(refresh),
      configDir: active?.configDir,
    });
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
  ipcMain.handle('switchThreadBranch', (_e, ref: string, branch: string) =>
    orch.switchThreadBranch(ref, branch),
  );
  ipcMain.handle('listPrs', async (_e, path: string) => listPrs(await resolveRepoRoot(path)));
  ipcMain.handle('listLinearIssues', (_e, agent: AgentKind, path: string) =>
    listLinearIssues(agent, path),
  );
  ipcMain.handle('resolveRepoRoot', (_e, cwd: string) => resolveRepoRoot(cwd));
  ipcMain.handle('getThreads', (_e, includeArchived?: boolean) =>
    orch.getThreads(Boolean(includeArchived)).map(slimThreadForUiList),
  );
  ipcMain.handle('getThread', (_e, id: string) => orch.getThread(id));
  ipcMain.handle('getThreadSlim', (_e, id: string) => {
    const thread = orch.getThread(id);
    return thread ? slimThreadForUiList(thread) : null;
  });
  ipcMain.handle('getRuntime', () => orch.getRuntime());
  ipcMain.handle('setMaxConcurrent', (_e, n: number) => {
    orch.setMaxConcurrent(n);
    updateAdvancedSettings({ maxConcurrent: n });
  });
  ipcMain.handle('createThread', async (_e, input: CreateThreadInput) => {
    // Light: repo-scoped worktree sanity only. The full routine (global heal
    // loop, History cleanup, queue adoption) on every create blocked the main
    // thread while several review worktrees were being added at once.
    await orch.reconcile(input.repoPath, { light: true });
    return orch.createThread(input);
  });
  ipcMain.handle('createChatTab', (_e, input) => orch.createChatTab(input));
  ipcMain.handle('requestReview', (_e, ref: string) => orch.requestReview(ref));
  ipcMain.handle('forkChatTab', (_e, input) => orch.forkChatTab(input));
  ipcMain.handle('forkThreadWorktree', async (_e, input) => {
    const source = orch.getThread(input.threadId);
    if (source) await orch.reconcile(source.repoPath, { light: true });
    return orch.forkThreadWorktree(input);
  });
  ipcMain.handle('renameThread', (_e, ref: string, title: string) =>
    orch.renameThread(ref, title),
  );
  ipcMain.handle('setWorkspaceTags', (_e, ref: string, tags: string[]) =>
    orch.setWorkspaceTags(ref, tags),
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
  ipcMain.handle('sendToThread', (_e, ref: string, prompt: string) =>
    orch.send(ref, prompt, { followUp: followUpBehavior() }),
  );
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
  ipcMain.handle('fanOut', (_e, refs: string[], prompt: string) =>
    orch.fanOut(refs, prompt, { followUp: followUpBehavior() }),
  );
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
        agent?: AgentKind;
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
  ipcMain.handle('getWorktreeDirtyStat', (_e, ref: string) =>
    orch.worktreeDirtyStat(ref),
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
  ipcMain.handle('statPath', (_e, ref: string, relativePath: string) =>
    orch.statPath(ref, relativePath),
  );
  ipcMain.handle('readFile', (_e, ref: string, relativePath: string, tail?: boolean) =>
    orch.readFile(ref, relativePath, tail),
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
  ipcMain.handle('listSkillsForRepo', (_e, repoPath: string) =>
    orch.listSkillsForRepo(typeof repoPath === 'string' ? repoPath : ''),
  );
  ipcMain.handle(
    'openInEditor',
    async (_e, ref: string, editor?: string, relativePath?: string) => {
      const t = orch.getThread(ref);
      if (!t) throw new Error(`Thread not found: ${ref}`);
      if (relativePath && (relativePath.includes('..') || relativePath.startsWith('/'))) {
        throw new Error('Invalid path');
      }
      const target = relativePath ? join(t.worktreePath, relativePath) : t.worktreePath;
      const cmd = (editor ?? process.env.SIDEBOARD_EDITOR ?? 'cursor').trim();
      const openerId = openerIdForEditor(cmd);
      if (openerId) {
        await openWorktreeFolder(openerId, target);
        return;
      }
      if (cmd.startsWith('/')) {
        await spawnDetached(cmd, [target]);
        return;
      }
      await execMacOpen(MAC_OPEN, ['-a', cmd, target]);
    },
  );
  ipcMain.handle('openWorktree', async (_e, ref: string, target: string) => {
    const t = orch.getThread(ref);
    if (!t) throw new Error(`Thread not found: ${ref}`);
    if (!isWorktreeOpenerId(target)) throw new Error(`Unknown opener: ${target}`);
    if (target === 'finder') {
      await revealWorktreeInFinder(t.worktreePath);
      return;
    }
    await openWorktreeFolder(target, t.worktreePath);
  });
  ipcMain.handle('listWorktreeOpeners', () => {
    const listed = listWorktreeOpenerBundles();
    return listed.map((bundle) => toWorktreeOpener(bundle, iconDataUrlForApp(bundle.iconPath)));
  });
  ipcMain.handle('runDevScript', (_e, ref: string, scriptName?: string) =>
    orch.startDev(ref, scriptName),
  );
  ipcMain.handle('stopDevScript', (_e, ref: string, scriptName?: string) =>
    orch.stopDev(ref, scriptName),
  );
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
    'cleanupHistory',
    (
      _e,
      opts?: { dryRun?: boolean; purgeOlderThanDays?: number; force?: boolean },
    ) => orch.cleanupHistory(opts),
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
    async (_e, ref: string, cols?: number, rows?: number, pane?: number) => {
      const { startTerminalSession } = await import('./terminal.js');
      return startTerminalSession(orch, ref, cols, rows, { pane });
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
  ipcMain.handle('terminal:snapshot', (_e, id: string) => {
    return import('./terminal.js').then((m) => m.snapshotTerminal(id));
  });
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
  ipcMain.handle('markPrReady', (_e, ref: string) => orch.markPrReady(ref));
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
        | 'ready-for-review'
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
  ipcMain.handle('getSetupLog', (_e, ref: string) => orch.getSetupLog(ref));
  ipcMain.handle('getRunLog', (_e, ref: string, scriptName?: string) =>
    orch.getRunLog(ref, scriptName),
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
  ipcMain.handle('askMicrophoneAccess', () => askMicrophoneAccess());
  ipcMain.handle('getDictationPrivacyHelp', () => ({ packaged: app.isPackaged }));
  ipcMain.handle(
    'transcribeDictation',
    async (_e, wavBase64: string, locale?: string) => {
      if (process.platform !== 'darwin') {
        throw new Error('Dictation is only available on macOS.');
      }
      if (typeof wavBase64 !== 'string' || wavBase64.length === 0 || wavBase64.length > 16_000_000) {
        throw new Error('Click the mic, speak, then click it again to stop.');
      }
      const buf = Buffer.from(wavBase64, 'base64');
      return transcribeWavFile(buf, typeof locale === 'string' && locale ? locale : 'en-US');
    },
  );
  ipcMain.handle('startLiveDictation', async (event, locale?: string) => {
    if (process.platform !== 'darwin') {
      throw new Error('Dictation is only available on macOS.');
    }
    const loc = typeof locale === 'string' && locale ? locale : 'en-US';
    const sender = event.sender;
    await startLiveSpeechDictate(loc, (ev) => {
      if (sender.isDestroyed()) return;
      if (ev.type === 'partial' || ev.type === 'final') {
        sender.send('liveDictationTranscript', {
          text: ev.text,
          isFinal: ev.type === 'final',
        });
        return;
      }
      sender.send('liveDictationError', { message: ev.message });
    });
  });
  ipcMain.on('liveDictationAudio', (_event, pcm16Base64: string) => {
    if (typeof pcm16Base64 !== 'string' || pcm16Base64.length === 0 || pcm16Base64.length > 200_000) {
      return;
    }
    pushLiveSpeechPcm(Buffer.from(pcm16Base64, 'base64'));
  });
  ipcMain.handle('stopLiveDictation', () => stopLiveSpeechDictate());
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
    if (!['http:', 'https:', 'mailto:', 'x-apple.systempreferences:'].includes(parsed.protocol)) {
      return;
    }
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
  // Agent / MCP children are real Node and need Keychain CAs (Linear picker
  // works here via net.fetch; agents otherwise get UNABLE_TO_GET_ISSUER_CERT_LOCALLY).
  const systemCaBundle = materializeSystemCaBundle();
  if (systemCaBundle && !process.env.NODE_EXTRA_CA_CERTS?.trim()) {
    process.env.NODE_EXTRA_CA_CERTS = systemCaBundle;
  }
  applySystemCaEnv(process.env);
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
  // MCP/CLI send_to_chat must not spawn worktree turns in the stdio child —
  // the board adopts persisted queues so live IPC reaches the chat UI.
  startDesktopHost();
  applyDockIcon();
  bindArtifactPreviewProtocol();
  setupMicrophonePermissions();
  registerIpc();
  setupNotifications();
  setupStoreWatcher();
  setupSchedulesWatcher();
  setupCaffeinateHoldWatcher();
  setupUpdater();
  // Slack reply watches are off. The phone remote is the away-from-desk session.
  // Worktree agents can die without writing a thread file; reclaim stale
  // `running` so wait_for_turn and the parent orchestrator notice.
  setInterval(() => {
    try {
      orch.healStaleRunningTurns();
    } catch {
      // Next tick retries.
    }
  }, 8_000);
  setupApplicationMenu(() => mainWindow);
  try {
    const root = await resolveRepoRoot(process.cwd());
    // Packaged launches often have cwd `/`, which is not a real project.
    if (root && root !== '/') {
      try {
        await ensureWorkspace(root);
        repoPath = root;
      } catch {
        // A removed project stays removed, even when this Mac launches inside it.
      }
    }
  } catch {
    // Leave repoPath empty when cwd is not inside a git repo (typical for Dock launches).
  }
  // Always reclaim stale agent turns + orphaned Run listeners — Dock launches
  // skip the cwd-repo branch above but still have persisted activeRuns.
  try {
    await orch.reconcile(repoPath || undefined, { reclaimStaleTurns: true });
  } catch {
    // Best-effort; UI can still open.
  }
  armSchedules();
  syncCaffeinate();
  orch.listWorkspaces();
  createWindow();
  if (mainWindow) setupTsServer(mainWindow);
  bindRemoteHostActivity(syncCaffeinate);
  bindPhoneOpenFile((request) => showPhoneFile(mainWindow, request));
  bindPhoneOpenArtifact((request) => showPhoneArtifact(mainWindow, request));
  stopSlackListenDaemon();
  startRemoteHost();

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
    // Detached run/setup scripts outlive Electron unless we kill them here.
    orch.stopAllRunScripts();
  } catch {
    // ignore
  }
  stopDesktopHost();
  destroyUrlPreview();
  stopCloudConnectDaemon();
  stopSlackListenDaemon();
  stopCaffeinate();
  destroyCaffeinateTray();
    try {
    dockUnreadCount = 0;
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
