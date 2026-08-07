import { BrowserView, shell, type BrowserWindow, type Rectangle } from 'electron';

export type UrlPreviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

let view: BrowserView | null = null;
let attachedWin: BrowserWindow | null = null;
let lastUrl = '';

function ensureView(win: BrowserWindow): BrowserView {
  if (!view) {
    view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.setBackgroundColor('#ffffff');
    view.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
    const emitNavigated = () => {
      const current = view?.webContents.getURL() ?? '';
      if (!current || current === 'about:blank') return;
      lastUrl = current;
      attachedWin?.webContents.send('url-preview:navigated', { url: current });
    };
    view.webContents.on('did-navigate', emitNavigated);
    view.webContents.on('did-navigate-in-page', emitNavigated);
    view.webContents.on('did-finish-load', emitNavigated);
  }

  if (attachedWin !== win) {
    if (attachedWin && !attachedWin.isDestroyed() && view) {
      attachedWin.removeBrowserView(view);
    }
    win.addBrowserView(view);
    attachedWin = win;
  }

  return view;
}

function clampBounds(bounds: UrlPreviewBounds): Rectangle {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

export function showUrlPreview(
  win: BrowserWindow,
  url: string,
  bounds: UrlPreviewBounds,
): void {
  const guest = ensureView(win);
  guest.setBounds(clampBounds(bounds));
  guest.setAutoResize({ width: false, height: false, horizontal: false, vertical: false });
  if (url && url !== lastUrl && url !== guest.webContents.getURL()) {
    lastUrl = url;
    void guest.webContents.loadURL(url);
  }
}

export function setUrlPreviewBounds(win: BrowserWindow, bounds: UrlPreviewBounds): void {
  if (!view || attachedWin !== win) return;
  view.setBounds(clampBounds(bounds));
}

export function navigateUrlPreview(win: BrowserWindow, url: string): void {
  const guest = ensureView(win);
  if (!url || url === guest.webContents.getURL()) return;
  lastUrl = url;
  void guest.webContents.loadURL(url);
}

export function reloadUrlPreview(win: BrowserWindow): void {
  if (!view || attachedWin !== win) return;
  view.webContents.reload();
}

export function hideUrlPreview(win: BrowserWindow | null): void {
  if (!view) return;
  const host = win && !win.isDestroyed() ? win : attachedWin;
  if (host && !host.isDestroyed()) {
    host.removeBrowserView(view);
  }
  attachedWin = null;
}

export function destroyUrlPreview(): void {
  if (view) {
    if (attachedWin && !attachedWin.isDestroyed()) {
      attachedWin.removeBrowserView(view);
    }
    try {
      view.webContents.destroy();
    } catch {
      // already destroyed
    }
    view = null;
  }
  attachedWin = null;
  lastUrl = '';
}
