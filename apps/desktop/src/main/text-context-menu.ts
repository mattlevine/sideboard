import {
  clipboard,
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
} from 'electron';
import {
  buildTextContextMenuItems,
  formatQuotedComposerText,
  selectChatTextScript,
  textContextTargetScript,
  type TextContextMenuItem,
  type TextContextTarget,
} from './text-context-menu-items';

function isMainFrame(win: BrowserWindow, params: ContextMenuParams): boolean {
  try {
    if (!params.frame) return true;
    return params.frame === win.webContents.mainFrame;
  } catch {
    return true;
  }
}

function toElectronItem(
  item: TextContextMenuItem,
  win: BrowserWindow,
  params: ContextMenuParams,
): MenuItemConstructorOptions {
  if (item.type === 'separator') return { type: 'separator' };
  if (item.type === 'role') {
    return { role: item.role, enabled: item.enabled };
  }
  if (item.type === 'copyLink') {
    return {
      label: 'Copy Link',
      click: () => clipboard.writeText(item.url),
    };
  }
  if (item.type === 'quote') {
    return {
      label: 'Quote in composer',
      click: () => {
        const quoted = formatQuotedComposerText(params.selectionText ?? '');
        if (!quoted.trim() || win.isDestroyed()) return;
        win.webContents.send('menu:quote-selection', quoted);
      },
    };
  }
  if (item.type === 'searchChat') {
    return {
      label: 'Search Chat',
      click: () => {
        if (win.isDestroyed()) return;
        win.webContents.send('menu:find-chat', (params.selectionText ?? '').trim().slice(0, 200));
      },
    };
  }
  return {
    label: 'Select All',
    click: () => {
      if (win.isDestroyed()) return;
      void win.webContents.executeJavaScript(selectChatTextScript(params.x, params.y));
    },
  };
}

async function popupTextContextMenu(win: BrowserWindow, params: ContextMenuParams): Promise<void> {
  if (win.isDestroyed() || !isMainFrame(win, params)) return;

  let target: TextContextTarget = { inChatText: false, skipNativeMenu: false };
  try {
    const raw = (await win.webContents.executeJavaScript(
      textContextTargetScript(params.x, params.y),
    )) as TextContextTarget | null;
    if (raw && typeof raw === 'object') {
      target = {
        inChatText: Boolean(raw.inChatText),
        skipNativeMenu: Boolean(raw.skipNativeMenu),
      };
    }
  } catch {
    // Still show Copy / Paste from Electron params.
  }

  const items = buildTextContextMenuItems(params, target, {
    isMac: process.platform === 'darwin',
  });
  if (!items?.length || win.isDestroyed()) return;

  Menu.buildFromTemplate(items.map((item) => toElectronItem(item, win, params))).popup({
    window: win,
    x: params.x,
    y: params.y,
  });
}

/** Native edit menu on the window; skips hosts that already own right-click. */
export function setupTextContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    void popupTextContextMenu(win, params);
  });
}
