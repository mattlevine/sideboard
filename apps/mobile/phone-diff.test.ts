import { describe, expect, it } from 'vitest';
import {
  changeBadge,
  diffCodeSelection,
  diffIndexSelection,
  diffSelectableBody,
  parseUnifiedPatch,
  tapDiffRow,
} from './phone-diff';

const PATCH = [
  'diff --git a/a.ts b/a.ts',
  'index 111..222 100644',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,3 +1,4 @@',
  ' same',
  '-old',
  '+new',
  '+added',
  ' tail',
].join('\n');

describe('parseUnifiedPatch', () => {
  it('colors additions and deletions the way the desktop diff does', () => {
    expect(parseUnifiedPatch(PATCH)).toEqual([
      { kind: 'context', lineNo: 1, text: 'same' },
      { kind: 'del', lineNo: 2, text: 'old' },
      { kind: 'add', lineNo: 2, text: 'new' },
      { kind: 'add', lineNo: 3, text: 'added' },
      { kind: 'context', lineNo: 4, text: 'tail' },
    ]);
  });

  it('treats an empty or binary patch as nothing to draw', () => {
    expect(parseUnifiedPatch('')).toEqual([]);
    expect(parseUnifiedPatch('Binary files a/x and b/x differ\n')).toEqual([]);
  });

  it('keeps blank lines and drops the no-newline marker', () => {
    const patch = ['@@ -1,3 +1,3 @@', ' ', '-', '+', '\\ No newline at end of file', ' tail'].join('\n');
    expect(parseUnifiedPatch(patch)).toEqual([
      { kind: 'context', lineNo: 1, text: '' },
      { kind: 'del', lineNo: 2, text: '' },
      { kind: 'add', lineNo: 2, text: '' },
      { kind: 'context', lineNo: 3, text: 'tail' },
    ]);
  });
});

describe('diffCodeSelection', () => {
  const rows = parseUnifiedPatch(PATCH);

  it('keeps add and delete marks and uses the file line numbers', () => {
    const body = diffSelectableBody(rows);
    expect(body).toBe(' same\n-old\n+new\n+added\n tail');
    const at = body.indexOf('-old');
    const range = diffCodeSelection(rows, at, at + '-old\n+new'.length);
    expect(range).toEqual({ startLine: 2, endLine: 2, text: '-old\n+new' });
  });

  it('ignores a blank selection', () => {
    expect(diffCodeSelection(rows, 0, 0)).toBeNull();
  });
});

describe('tapDiffRow', () => {
  it('selects one row, extends on the next tap, then starts over', () => {
    const one = tapDiffRow(null, 1);
    expect(one).toEqual({ anchor: 1, focus: 1 });
    expect(tapDiffRow(one, 3)).toEqual({ anchor: 1, focus: 3 });
    expect(tapDiffRow({ anchor: 1, focus: 3 }, 4)).toEqual({ anchor: 4, focus: 4 });
  });
});

describe('diffIndexSelection', () => {
  const rows = parseUnifiedPatch(PATCH);

  it('uses the same line numbers and marks as a text selection', () => {
    expect(diffIndexSelection(rows, 2, 1)).toEqual({ startLine: 2, endLine: 2, text: '-old\n+new' });
  });

  it('ignores a range outside the diff', () => {
    expect(diffIndexSelection(rows, 0, 9)).toBeNull();
  });
});

describe('changeBadge', () => {
  it('shows the status letter and only the non-zero counts', () => {
    expect(changeBadge('M', '+12 −0')).toEqual({ letter: 'M', letterColor: '#c4a574', add: 12 });
    expect(changeBadge('A', '+4 −0')).toEqual({ letter: 'A', letterColor: '#6a9955', add: 4 });
    expect(changeBadge('D', '+0 −3')).toEqual({ letter: 'D', letterColor: '#f14c4c', del: 3 });
    expect(changeBadge('M', '+2 −1')).toEqual({ letter: 'M', letterColor: '#c4a574', add: 2, del: 1 });
  });

  it('keeps a letter when the file has no line counts', () => {
    expect(changeBadge('M', undefined)).toEqual({ letter: 'M', letterColor: '#c4a574' });
  });
});
