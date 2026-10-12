import { describe, expect, it } from 'vitest';
import { changeBadge, parseUnifiedPatch } from './phone-diff';

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
