import { app, BrowserWindow, Notification, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { watch } from 'chokidar';
import { autoUpdater } from 'electron-updater';
import {
  detectAgents,
  getOrchestrator,
  listBranches,
  listPrs,
  listLinearIssues,
  resolveRepoRoot,
  startOrchestration,
  hasConductorHook,
  threadsDir,
  type AgentKind,
  type AdoptInput,
  type CreateThreadInput,
  type OrchestratorEvent,
} from '@sideboard/core';

let mainWindow: BrowserWindow | null = null;
let repoPath = process.cwd();
const orch = getOrchestrator();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Sideboard',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
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
    mainWindow = null;
  });
}

function setupUpdater(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const check = () => {
    void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  };
  check();
  setInterval(check, 4 * 60 * 60 * 1000);

  autoUpdater.on('update-downloaded', () => {
    if (!mainWindow) return;
    mainWindow.webContents.send('update:ready');
  });
}

function setupStoreWatcher(): void {
  const dir = threadsDir();
  const watcher = watch(dir, { ignoreInitial: true, depth: 0 });
  const notify = () => {
    mainWindow?.webContents.send('threads:changed');
  };
  watcher.on('add', notify);
  watcher.on('change', notify);
  watcher.on('unlink', notify);
  app.on('will-quit', () => {
    void watcher.close();
  });
}

function setupNotifications(): void {
  orch.on((event: OrchestratorEvent) => {
    mainWindow?.webContents.send('orchestrator:event', event);

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
  ipcMain.handle('detectAgents', () => detectAgents());
  ipcMain.handle('listBranches', async (_e, path: string) => listBranches(await resolveRepoRoot(path)));
  ipcMain.handle('listPrs', async (_e, path: string) => listPrs(await resolveRepoRoot(path)));
  ipcMain.handle('listLinearIssues', (_e, agent: AgentKind, path: string) =>
    listLinearIssues(agent, path),
  );
  ipcMain.handle('resolveRepoRoot', (_e, cwd: string) => resolveRepoRoot(cwd));
  ipcMain.handle('getThreads', (_e, includeArchived?: boolean) =>
    orch.getThreads(Boolean(includeArchived)),
  );
  ipcMain.handle('getThread', (_e, id: string) => orch.getThread(id));
  ipcMain.handle('createThread', async (_e, input: CreateThreadInput) => {
    await orch.reconcile(input.repoPath);
    return orch.createThread(input);
  });
  ipcMain.handle('adopt', (_e, input: AdoptInput) => orch.adopt(input));
  ipcMain.handle('listConductor', () => orch.listConductor());
  ipcMain.handle('adoptFromConductor', (_e, id: string) => orch.adoptFromConductor(id));
  ipcMain.handle('sendToThread', (_e, ref: string, prompt: string) => orch.send(ref, prompt));
  ipcMain.handle('fanOut', (_e, refs: string[], prompt: string) => orch.fanOut(refs, prompt));
  ipcMain.handle(
    'startOrchestration',
    (_e, opts: { goal: string; agent: AgentKind; repoPath: string }) => startOrchestration(opts),
  );
  ipcMain.handle('stopThread', (_e, ref: string) => orch.stop(ref));
  ipcMain.handle('getDiff', (_e, ref: string) => orch.diff(ref));
  ipcMain.handle('openInEditor', async (_e, ref: string, editor?: string) => {
    const t = orch.getThread(ref);
    if (!t) throw new Error(`Thread not found: ${ref}`);
    const cmd = editor ?? process.env.SIDEBOARD_EDITOR ?? 'cursor';
    spawn(cmd, [t.worktreePath], { detached: true, stdio: 'ignore' }).unref();
  });
  ipcMain.handle('runDevScript', (_e, ref: string) => orch.startDev(ref));
  ipcMain.handle('stopDevScript', (_e, ref: string) => {
    orch.stopDev(ref);
  });
  ipcMain.handle('previewLand', (_e, ref: string) => orch.previewLand(ref));
  ipcMain.handle('confirmLand', (_e, ref: string) => orch.confirmLand(ref));
  ipcMain.handle('archiveThread', (_e, ref: string) => orch.archive(ref));
  ipcMain.handle('purgeThread', (_e, ref: string, opts?: { deleteBranch?: boolean }) =>
    orch.purge(ref, opts),
  );
  ipcMain.handle('restoreThread', (_e, ref: string) => orch.restore(ref));
  ipcMain.handle('getRepoPath', () => repoPath);
  ipcMain.handle('setRepoPath', async (_e, path: string) => {
    repoPath = await resolveRepoRoot(path);
    await orch.reconcile(repoPath);
    return repoPath;
  });
  ipcMain.handle('hasConductorHook', (_e, path: string) => hasConductorHook(path));
  ipcMain.handle('pickRepoPath', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    repoPath = await resolveRepoRoot(result.filePaths[0]);
    await orch.reconcile(repoPath);
    return repoPath;
  });
  ipcMain.handle('installUpdate', () => {
    autoUpdater.quitAndInstall();
  });
  ipcMain.handle('openExternal', (_e, url: string) => shell.openExternal(url));
}

app.whenReady().then(async () => {
  registerIpc();
  setupNotifications();
  setupStoreWatcher();
  setupUpdater();
  try {
    repoPath = await resolveRepoRoot(process.cwd());
  } catch {
    repoPath = process.cwd();
  }
  await orch.reconcile(repoPath);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
