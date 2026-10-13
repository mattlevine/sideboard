import { describe, expect, it } from 'vitest';
import {
  codeRefChipLabel,
  holdsCitedSelection,
  keepOpenCursor,
  lineStartOffset,
  openCursorSelection,
  phoneSendExtras,
  scrollOffsetForLine,
  selectableFileText,
  selectionLineRange,
} from './phone-code-ref';

describe('selectionLineRange', () => {
  const content = 'alpha\nbeta\ngamma\n';

  it('maps a multi-line selection and drops the trailing newline', () => {
    const range = selectionLineRange(content, 6, 16);
    expect(range).toEqual({ startLine: 2, endLine: 3, text: 'beta\ngamma' });
    expect(range && codeRefChipLabel({ path: 'src/app.tsx', ...range })).toBe('app.tsx:L2-3');
  });

  it('keeps a single line when the selection ends on the next newline', () => {
    expect(selectionLineRange(content, 6, 11)).toEqual({ startLine: 2, endLine: 2, text: 'beta' });
  });

  it('ignores an empty or blank selection', () => {
    expect(selectionLineRange(content, 4, 4)).toBeNull();
    expect(selectionLineRange(content, 5, 6)).toBeNull();
  });
});

describe('holdsCitedSelection', () => {
  it('keeps a citation when focus reports a caret', () => {
    expect(holdsCitedSelection(true, 0, 0)).toBe(true);
  });

  it('lets a drag replace the citation', () => {
    expect(holdsCitedSelection(true, 6, 11)).toBe(false);
    expect(holdsCitedSelection(false, 0, 0)).toBe(false);
  });
});

describe('keepOpenCursor', () => {
  const top = { start: 0, end: 0 };
  const cited = { start: 6, end: 11 };

  it('holds the top caret when focus reports the end of the file', () => {
    expect(keepOpenCursor(true, 0, 0, 20, top)).toBe(true);
    expect(keepOpenCursor(true, 20, 20, 20, top)).toBe(true);
  });

  it('lets a tap or a drag move the cursor', () => {
    expect(keepOpenCursor(true, 4, 4, 20, top)).toBe(false);
    expect(keepOpenCursor(true, 0, 6, 20, top)).toBe(false);
    expect(keepOpenCursor(false, 20, 20, 20, top)).toBe(false);
  });

  it('keeps a cited range until the user drags', () => {
    expect(keepOpenCursor(true, 20, 20, 20, cited)).toBe(true);
    expect(keepOpenCursor(true, 4, 9, 20, cited)).toBe(false);
  });
});

describe('openCursorSelection', () => {
  const content = 'alpha\nbeta\ngamma\n';

  it('puts the caret on the first character when the file has no citation', () => {
    expect(openCursorSelection(content)).toEqual({ start: 0, end: 0 });
    expect(scrollOffsetForLine(undefined)).toBe(0);
    expect(scrollOffsetForLine(1)).toBe(0);
  });

  it('selects the cited lines and scrolls to that line', () => {
    expect(openCursorSelection(content, 2, 2)).toEqual({ start: 6, end: 11 });
    expect(openCursorSelection(content, 2)).toEqual({ start: 6, end: 11 });
    expect(scrollOffsetForLine(2, 20)).toBe(20);
  });
});

describe('lineStartOffset', () => {
  const content = 'alpha\nbeta\ngamma\n';

  it('finds the start of each line', () => {
    expect(lineStartOffset(content, 1)).toBe(0);
    expect(lineStartOffset(content, 2)).toBe(6);
    expect(lineStartOffset(content, 3)).toBe(11);
    expect(lineStartOffset(content, 4)).toBe(content.length);
  });
});

describe('selectableFileText', () => {
  const file = {
    encoding: 'utf8' as const,
    path: 'apps/mobile/App.tsx',
    content: 'const n = 1\n',
  };

  it('allows a text file', () => {
    expect(selectableFileText(file)?.path).toBe('apps/mobile/App.tsx');
  });

  it('skips images, folders, binary files, and diffs', () => {
    expect(selectableFileText({ ...file, mime: 'image/png' })).toBeNull();
    expect(selectableFileText({ ...file, directory: true })).toBeNull();
    expect(selectableFileText({ ...file, encoding: 'base64' })).toBeNull();
    expect(selectableFileText({ ...file, diff: true })).toBeNull();
  });
});

describe('phoneSendExtras', () => {
  it('sends a code ref without the chip id', () => {
    const extras = phoneSendExtras(
      [],
      [],
      [{ id: '1', path: 'apps/mobile/App.tsx', startLine: 10, endLine: 10, text: 'const n = 1' }],
    );
    expect(extras.attached).toBe(true);
    expect(extras.names).toEqual(['App.tsx:L10']);
    expect(extras.payload).toEqual({
      refs: [{ path: 'apps/mobile/App.tsx', startLine: 10, endLine: 10, text: 'const n = 1' }],
    });
  });
});
