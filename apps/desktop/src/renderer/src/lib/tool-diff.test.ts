import { describe, expect, it } from 'vitest';
import { parseUnifiedPatch } from './tool-diff';

describe('parseUnifiedPatch', () => {
  it('parses add/del/context with line numbers', () => {
    const patch = [
      'diff --git a/README.md b/README.md',
      'index bad2904..22e131c 100644',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -2,4 +2,5 @@',
      ' keep',
      '-old line',
      '+new line',
      '+extra',
      ' tail',
    ].join('\n');

    const rows = parseUnifiedPatch(patch);
    expect(rows).toEqual([
      { kind: 'context', lineNo: 2, text: 'keep' },
      { kind: 'del', lineNo: 3, text: 'old line' },
      { kind: 'add', lineNo: 3, text: 'new line' },
      { kind: 'add', lineNo: 4, text: 'extra' },
      { kind: 'context', lineNo: 5, text: 'tail' },
    ]);
  });

  it('returns empty for blank or header-only patches', () => {
    expect(parseUnifiedPatch('')).toEqual([]);
    expect(
      parseUnifiedPatch('diff --git a/x b/x\nBinary files a/x and b/x differ\n'),
    ).toEqual([]);
  });
});
