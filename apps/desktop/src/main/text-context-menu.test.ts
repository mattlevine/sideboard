import { describe, expect, it } from 'vitest';
import {
  CHAT_TEXT_SELECTOR,
  SKIP_NATIVE_TEXT_MENU_SELECTOR,
  buildTextContextMenuItems,
  formatQuotedComposerText,
  resolveTextContextTarget,
  safeContextLinkUrl,
  selectChatTextScript,
  textContextTargetScript,
} from './text-context-menu-items';

function fakeEl(matches: string[]): { closest: (sel: string) => object | null } {
  const set = new Set(matches);
  return {
    closest: (sel: string) => (set.has(sel) ? {} : null),
  };
}

describe('formatQuotedComposerText', () => {
  it('prefixes each line and leaves room to type after', () => {
    expect(formatQuotedComposerText('hello\nworld')).toBe('> hello\n> world\n\n');
  });

  it('keeps blank lines as bare quote markers', () => {
    expect(formatQuotedComposerText('hello\n\nworld')).toBe('> hello\n>\n> world\n\n');
  });

  it('normalizes CRLF and trims surrounding newlines', () => {
    expect(formatQuotedComposerText('\r\nfoo\r\nbar\r\n')).toBe('> foo\n> bar\n\n');
  });

  it('returns empty for whitespace', () => {
    expect(formatQuotedComposerText('   \n\t')).toBe('');
    expect(formatQuotedComposerText('')).toBe('');
  });
});

describe('safeContextLinkUrl', () => {
  it('allows http(s) and mailto', () => {
    expect(safeContextLinkUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeContextLinkUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
  });

  it('rejects javascript and empty', () => {
    expect(safeContextLinkUrl('javascript:alert(1)')).toBeNull();
    expect(safeContextLinkUrl('')).toBeNull();
    expect(safeContextLinkUrl(undefined)).toBeNull();
  });
});

describe('resolveTextContextTarget', () => {
  it('detects chat prose vs skip hosts', () => {
    expect(resolveTextContextTarget(null)).toEqual({ inChatText: false, skipNativeMenu: false });
    expect(resolveTextContextTarget(fakeEl([CHAT_TEXT_SELECTOR]))).toEqual({
      inChatText: true,
      skipNativeMenu: false,
    });
    expect(resolveTextContextTarget(fakeEl([SKIP_NATIVE_TEXT_MENU_SELECTOR]))).toEqual({
      inChatText: false,
      skipNativeMenu: true,
    });
  });
});

describe('buildTextContextMenuItems', () => {
  it('hides the menu on skip hosts', () => {
    expect(
      buildTextContextMenuItems(
        { selectionText: 'x', isEditable: false },
        { inChatText: false, skipNativeMenu: true },
        { isMac: true, showInspect: false },
      ),
    ).toBeNull();
  });

  it('hides the menu on empty chrome', () => {
    expect(
      buildTextContextMenuItems(
        { selectionText: '', isEditable: false },
        { inChatText: false, skipNativeMenu: false },
        { isMac: true, showInspect: false },
      ),
    ).toBeNull();
  });

  it('offers copy, quote, and message select-all in chat', () => {
    const items = buildTextContextMenuItems(
      { selectionText: 'ship the menu', isEditable: false },
      { inChatText: true, skipNativeMenu: false },
      { isMac: true, showInspect: false },
    );
    expect(items?.map((i) => ('role' in i ? i.role : i.type))).toEqual([
      'copy',
      'quote',
      'selectChatText',
    ]);
  });

  it('offers select-all in chat with no selection', () => {
    const items = buildTextContextMenuItems(
      { selectionText: '', isEditable: false },
      { inChatText: true, skipNativeMenu: false },
      { isMac: true, showInspect: false },
    );
    expect(items).toEqual([{ type: 'selectChatText' }]);
  });

  it('does not quote outside chat', () => {
    const items = buildTextContextMenuItems(
      { selectionText: 'settings copy', isEditable: false },
      { inChatText: false, skipNativeMenu: false },
      { isMac: false, showInspect: false },
    );
    expect(items?.map((i) => ('role' in i ? i.role : i.type))).toEqual(['copy', 'selectAll']);
  });

  it('uses edit roles in the composer', () => {
    const items = buildTextContextMenuItems(
      {
        selectionText: 'draft',
        isEditable: true,
        editFlags: { canUndo: false, canRedo: false, canCut: true, canCopy: true, canPaste: true },
      },
      { inChatText: false, skipNativeMenu: false },
      { isMac: true, showInspect: false },
    );
    expect(items?.some((i) => i.type === 'quote')).toBe(false);
    expect(items?.map((i) => ('role' in i ? i.role : i.type))).toEqual([
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'pasteAndMatchStyle',
      'selectAll',
    ]);
  });

  it('adds copy-link for http urls', () => {
    const items = buildTextContextMenuItems(
      { selectionText: '', isEditable: false, linkURL: 'https://github.com/mattlevine/sideboard' },
      { inChatText: false, skipNativeMenu: false },
      { isMac: true, showInspect: false },
    );
    expect(items).toEqual([
      { type: 'copyLink', url: 'https://github.com/mattlevine/sideboard' },
    ]);
  });

  it('appends inspect in dev without a leading separator-only menu', () => {
    const items = buildTextContextMenuItems(
      { selectionText: '', isEditable: false },
      { inChatText: false, skipNativeMenu: false },
      { isMac: true, showInspect: true },
    );
    expect(items).toEqual([{ type: 'inspect' }]);
  });
});

describe('injected scripts', () => {
  it('embed the shared selectors', () => {
    const script = textContextTargetScript(12.8, 40.2);
    expect(script).toContain('elementFromPoint(13, 40)');
    expect(script).toContain(JSON.stringify(CHAT_TEXT_SELECTOR));
    expect(script).toContain(JSON.stringify(SKIP_NATIVE_TEXT_MENU_SELECTOR));
    expect(selectChatTextScript(1, 2)).toContain(JSON.stringify(CHAT_TEXT_SELECTOR));
  });
});
