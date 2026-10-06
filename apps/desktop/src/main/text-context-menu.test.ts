import { describe, expect, it } from 'vitest';
import {
  CHAT_TEXT_SELECTOR,
  ARTIFACT_TEXT_SELECTOR,
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
    expect(resolveTextContextTarget(null)).toEqual({
      inChatText: false,
      inArtifactText: false,
      skipNativeMenu: false,
    });
    expect(resolveTextContextTarget(fakeEl([CHAT_TEXT_SELECTOR]))).toEqual({
      inChatText: true,
      inArtifactText: false,
      skipNativeMenu: false,
    });
    expect(resolveTextContextTarget(fakeEl([SKIP_NATIVE_TEXT_MENU_SELECTOR]))).toEqual({
      inChatText: false,
      inArtifactText: false,
      skipNativeMenu: true,
    });
    expect(resolveTextContextTarget(fakeEl([ARTIFACT_TEXT_SELECTOR]))).toEqual({
      inChatText: false,
      inArtifactText: true,
      skipNativeMenu: false,
    });
  });
});

describe('buildTextContextMenuItems', () => {
  it('hides the menu on skip hosts', () => {
    expect(
      buildTextContextMenuItems(
        { selectionText: 'x', isEditable: false },
        { inChatText: false, inArtifactText: false, skipNativeMenu: true },
        { isMac: true },
      ),
    ).toBeNull();
  });

  it('hides the menu on empty chrome', () => {
    expect(
      buildTextContextMenuItems(
        { selectionText: '', isEditable: false },
        { inChatText: false, inArtifactText: false, skipNativeMenu: false },
        { isMac: true },
      ),
    ).toBeNull();
  });

  it('offers copy, quote, and message select-all in chat', () => {
    const items = buildTextContextMenuItems(
      { selectionText: 'ship the menu', isEditable: false },
      { inChatText: true, inArtifactText: false, skipNativeMenu: false },
      { isMac: true },
    );
    expect(items?.map((i) => ('role' in i ? i.role : i.type))).toEqual([
      'copy',
      'quote',
      'readAloud',
      'searchChat',
      'selectChatText',
    ]);
  });

  it('offers select-all in chat with no selection', () => {
    const items = buildTextContextMenuItems(
      { selectionText: '', isEditable: false },
      { inChatText: true, inArtifactText: false, skipNativeMenu: false },
      { isMac: true },
    );
    expect(items).toEqual([{ type: 'searchChat' }, { type: 'selectChatText' }]);
  });

  it('offers read aloud for selected artifact text', () => {
    const items = buildTextContextMenuItems(
      { selectionText: 'dashboard copy', isEditable: false },
      { inChatText: false, inArtifactText: true, skipNativeMenu: false },
      { isMac: true },
    );
    expect(items?.map((i) => ('role' in i ? i.role : i.type))).toEqual([
      'copy',
      'readAloud',
      'selectAll',
    ]);
    expect(items?.some((i) => i.type === 'quote')).toBe(false);
  });

  it('does not quote outside chat', () => {
    const items = buildTextContextMenuItems(
      { selectionText: 'settings copy', isEditable: false },
      { inChatText: false, inArtifactText: false, skipNativeMenu: false },
      { isMac: false },
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
      { inChatText: false, inArtifactText: false, skipNativeMenu: false },
      { isMac: true },
    );
    expect(items?.some((i) => i.type === 'quote')).toBe(false);
    expect(items?.some((i) => i.type === 'readAloud')).toBe(false);
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
      { inChatText: false, inArtifactText: false, skipNativeMenu: false },
      { isMac: true },
    );
    expect(items).toEqual([
      { type: 'copyLink', url: 'https://github.com/mattlevine/sideboard' },
    ]);
  });
});

describe('injected scripts', () => {
  it('embed the shared selectors', () => {
    const script = textContextTargetScript(12.8, 40.2);
    expect(script).toContain('elementFromPoint(13, 40)');
    expect(script).toContain(JSON.stringify(CHAT_TEXT_SELECTOR));
    expect(script).toContain(JSON.stringify(ARTIFACT_TEXT_SELECTOR));
    expect(script).toContain(JSON.stringify(SKIP_NATIVE_TEXT_MENU_SELECTOR));
    expect(selectChatTextScript(1, 2)).toContain(JSON.stringify(CHAT_TEXT_SELECTOR));
  });
});
