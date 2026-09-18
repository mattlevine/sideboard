/** Hosts that already own right-click (file tree, Monaco, xterm). */
export const SKIP_NATIVE_TEXT_MENU_SELECTOR =
  '[data-skip-native-text-menu], .monaco-editor, .xterm, .xterm-helper-textarea';

/** Chat message prose — Quote and message-scoped Select All. */
export const CHAT_TEXT_SELECTOR = '[data-chat-text]';

export type TextContextTarget = {
  inChatText: boolean;
  skipNativeMenu: boolean;
};

export type TextContextMenuItem =
  | { type: 'separator' }
  | {
      type: 'role';
      role:
        | 'undo'
        | 'redo'
        | 'cut'
        | 'copy'
        | 'paste'
        | 'pasteAndMatchStyle'
        | 'selectAll';
      enabled?: boolean;
    }
  | { type: 'copyLink'; url: string }
  | { type: 'quote' }
  | { type: 'selectChatText' }
  | { type: 'inspect' };

export function formatQuotedComposerText(selection: string): string {
  const trimmed = selection.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
  if (!trimmed.trim()) return '';
  const quoted = trimmed
    .split('\n')
    .map((line) => (line.length ? `> ${line}` : '>'))
    .join('\n');
  return `${quoted}\n\n`;
}

export function safeContextLinkUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const u = new URL(href);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') {
      return u.href;
    }
  } catch {
    // ignore
  }
  return null;
}

export function resolveTextContextTarget(el: { closest: (sel: string) => unknown } | null): TextContextTarget {
  if (!el) return { inChatText: false, skipNativeMenu: false };
  return {
    skipNativeMenu: Boolean(el.closest(SKIP_NATIVE_TEXT_MENU_SELECTOR)),
    inChatText: Boolean(el.closest(CHAT_TEXT_SELECTOR)),
  };
}

export function textContextTargetScript(x: number, y: number): string {
  const px = Number.isFinite(x) ? Math.round(x) : 0;
  const py = Number.isFinite(y) ? Math.round(y) : 0;
  return `(() => {
    const el = document.elementFromPoint(${px}, ${py});
    if (!el) return { inChatText: false, skipNativeMenu: false };
    return {
      skipNativeMenu: Boolean(el.closest(${JSON.stringify(SKIP_NATIVE_TEXT_MENU_SELECTOR)})),
      inChatText: Boolean(el.closest(${JSON.stringify(CHAT_TEXT_SELECTOR)})),
    };
  })()`;
}

export function selectChatTextScript(x: number, y: number): string {
  const px = Number.isFinite(x) ? Math.round(x) : 0;
  const py = Number.isFinite(y) ? Math.round(y) : 0;
  return `(() => {
    const el = document.elementFromPoint(${px}, ${py})?.closest(${JSON.stringify(CHAT_TEXT_SELECTOR)});
    if (!el) return false;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  })()`;
}

function compactMenu(items: TextContextMenuItem[]): TextContextMenuItem[] {
  const out: TextContextMenuItem[] = [];
  for (const item of items) {
    if (item.type === 'separator') {
      if (out.length === 0 || out[out.length - 1]?.type === 'separator') continue;
      out.push(item);
      continue;
    }
    out.push(item);
  }
  while (out[out.length - 1]?.type === 'separator') out.pop();
  return out;
}

export function buildTextContextMenuItems(
  params: {
    selectionText?: string;
    isEditable?: boolean;
    linkURL?: string;
    editFlags?: {
      canUndo?: boolean;
      canRedo?: boolean;
      canCut?: boolean;
      canCopy?: boolean;
      canPaste?: boolean;
      canSelectAll?: boolean;
    };
  },
  target: TextContextTarget,
  opts: { isMac: boolean; showInspect: boolean },
): TextContextMenuItem[] | null {
  if (target.skipNativeMenu) return null;

  const selection = params.selectionText ?? '';
  const hasSelection = selection.trim().length > 0;
  const link = safeContextLinkUrl(params.linkURL);
  const flags = params.editFlags ?? {};

  if (!params.isEditable && !hasSelection && !target.inChatText && !link && !opts.showInspect) {
    return null;
  }

  const items: TextContextMenuItem[] = [];

  if (params.isEditable) {
    items.push(
      { type: 'role', role: 'undo', enabled: flags.canUndo },
      { type: 'role', role: 'redo', enabled: flags.canRedo },
      { type: 'separator' },
      { type: 'role', role: 'cut', enabled: flags.canCut },
      { type: 'role', role: 'copy', enabled: flags.canCopy ?? hasSelection },
      { type: 'role', role: 'paste', enabled: flags.canPaste },
    );
    if (opts.isMac) items.push({ type: 'role', role: 'pasteAndMatchStyle' });
    items.push({ type: 'role', role: 'selectAll', enabled: flags.canSelectAll ?? true });
  } else {
    if (hasSelection) {
      items.push({ type: 'role', role: 'copy', enabled: flags.canCopy ?? true });
    }
    if (hasSelection && target.inChatText) {
      items.push({ type: 'quote' });
    }
    if (target.inChatText) {
      items.push({ type: 'selectChatText' });
    } else if (hasSelection) {
      items.push({ type: 'role', role: 'selectAll', enabled: flags.canSelectAll ?? true });
    }
  }

  if (link) {
    items.push({ type: 'separator' }, { type: 'copyLink', url: link });
  }

  if (opts.showInspect) {
    items.push({ type: 'separator' }, { type: 'inspect' });
  }

  const compacted = compactMenu(items);
  return compacted.length ? compacted : null;
}
