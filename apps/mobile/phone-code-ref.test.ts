import { describe, expect, it } from 'vitest';
import {
  codeRefChipLabel,
  holdsCitedSelection,
  lineStartOffset,
  phoneSendExtras,
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
