import {
  app,
  dialog,
  Menu,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import { autoUpdater } from 'electron-updater';

type UpdatePhase = 'idle' | 'checking' | 'available' | 'ready' | 'error';

let phase: UpdatePhase = 'idle';
let latestVersion: string | null = null;
/** True while a menu/settings-triggered check is in flight (drives result dialogs). */
let manualCheck = false;

function sendOpenSettings(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  win.show();
  win.focus();
  win.webContents.send('menu:open-settings');
}

async function showUpToDate(): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    message: 'You’re up to date',
    detail: `Sideboard ${app.getVersion()} is the latest version.`,
    buttons: ['OK'],
    defaultId: 0,
  });
}

async function showReadyPrompt(version: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: `Sideboard ${version} is ready to install`,
    detail: 'Restart now to apply the update.',
    buttons: ['Restart to Update', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    autoUpdater.quitAndInstall();
  }
}

export async function checkForUpdatesManual(): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'Check for Updates',
      detail:
        'Auto-update only runs in packaged Sideboard builds (DMG / installed app). You’re running a development build.',
      buttons: ['OK'],
      defaultId: 0,
    });
    return;
  }

  if (phase === 'ready' && latestVersion) {
    await showReadyPrompt(latestVersion);
    return;
  }

  if (phase === 'checking' || manualCheck) return;

  manualCheck = true;
  phase = 'checking';
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    manualCheck = false;
    phase = 'idle';
    await dialog.showMessageBox({
      type: 'error',
      message: 'Couldn’t check for updates',
      detail: err instanceof Error ? err.message : String(err),
      buttons: ['OK'],
      defaultId: 0,
    });
  }
}

/** Wire electron-updater events used by the app menu dialogs. */
export function bindUpdaterEvents(_getMainWindow: () => BrowserWindow | null): void {
  autoUpdater.on('checking-for-update', () => {
    phase = 'checking';
  });

  autoUpdater.on('update-available', (info) => {
    phase = 'available';
    latestVersion = info.version;
    if (manualCheck) {
      manualCheck = false;
      void dialog.showMessageBox({
        type: 'info',
        message: 'Update available',
        detail: `Sideboard ${info.version} is downloading in the background.`,
        buttons: ['OK'],
        defaultId: 0,
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    phase = 'idle';
    latestVersion = null;
    if (manualCheck) {
      manualCheck = false;
      void showUpToDate();
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    phase = 'ready';
    latestVersion = info.version;
    if (manualCheck) {
      manualCheck = false;
      void showReadyPrompt(info.version);
    }
  });

  autoUpdater.on('error', (err) => {
    phase = 'error';
    if (manualCheck) {
      manualCheck = false;
      void dialog.showMessageBox({
        type: 'error',
        message: 'Couldn’t check for updates',
        detail: err instanceof Error ? err.message : String(err),
        buttons: ['OK'],
        defaultId: 0,
      });
    }
    phase = 'idle';
  });
}

export function setupApplicationMenu(getMainWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === 'darwin';

  const macAppMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about' },
      {
        label: 'Check for Updates…',
        click: () => {
          void checkForUpdatesManual();
        },
      },
      { type: 'separator' },
      {
        label: 'Settings…',
        accelerator: 'CmdOrCtrl+,',
        click: () => sendOpenSettings(getMainWindow()),
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      ...(!isMac
        ? ([
            {
              label: 'Settings…',
              accelerator: 'CmdOrCtrl+,',
              click: () => sendOpenSettings(getMainWindow()),
            },
            { type: 'separator' as const },
            {
              label: 'Check for Updates…',
              click: () => {
                void checkForUpdatesManual();
              },
            },
            { type: 'separator' as const },
          ] satisfies MenuItemConstructorOptions[])
        : []),
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? ([
            { role: 'pasteAndMatchStyle' as const },
            { role: 'delete' as const },
            { role: 'selectAll' as const },
          ] satisfies MenuItemConstructorOptions[])
        : ([
            { role: 'delete' as const },
            { type: 'separator' as const },
            { role: 'selectAll' as const },
          ] satisfies MenuItemConstructorOptions[])),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? ([
            { type: 'separator' as const },
            { role: 'front' as const },
          ] satisfies MenuItemConstructorOptions[])
        : ([{ role: 'close' as const }] satisfies MenuItemConstructorOptions[])),
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: 'Help',
    submenu: [
      {
        label: 'Sideboard on GitHub',
        click: () => {
          void shell.openExternal('https://github.com/mattlevine/sideboard');
        },
      },
      ...(!isMac
        ? ([
            { type: 'separator' as const },
            { role: 'about' as const },
          ] satisfies MenuItemConstructorOptions[])
        : []),
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [macAppMenu] : []),
    fileMenu,
    editMenu,
    viewMenu,
    windowMenu,
    helpMenu,
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
