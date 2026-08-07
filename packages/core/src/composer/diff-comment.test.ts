import { describe, expect, it } from 'vitest';
import { buildDiffCommentAttachment } from './diff-comment.js';
import { expandComposerPrompt } from './expand.js';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('buildDiffCommentAttachment', () => {
  it('formats path, range, comment, and cited diff', () => {
    const att = buildDiffCommentAttachment({
      path: 'src/app.ts',
      comment: 'Guard against null here.',
      lines: [
        { side: 'del', lineNo: 10, text: 'const x = foo.bar;' },
        { side: 'add', lineNo: 10, text: 'const x = foo?.bar;' },
      ],
      id: 'fixed-id',
    });

    expect(att).toEqual({
      id: 'fixed-id',
      name: 'src/app.ts:L10',
      kind: 'diff-comment',
      content: expect.stringContaining('Guard against null here.'),
    });
    expect(att.content).toContain('```diff');
    expect(att.content).toContain('-const x = foo.bar;');
    expect(att.content).toContain('+const x = foo?.bar;');
    expect(att.content).toContain('src/app.ts');
  });

  it('uses a range label for multi-line selections', () => {
    const att = buildDiffCommentAttachment({
      path: 'a.ts',
      comment: 'Rename',
      lines: [
        { side: 'context', lineNo: 3, text: 'keep' },
        { side: 'add', lineNo: 5, text: 'extra' },
      ],
    });
    expect(att.name).toBe('a.ts:L3-5');
  });

  it('rejects empty comment or lines', () => {
    expect(() =>
      buildDiffCommentAttachment({
        path: 'a.ts',
        comment: '  ',
        lines: [{ side: 'add', lineNo: 1, text: 'x' }],
      }),
    ).toThrow(/note/i);
    expect(() =>
      buildDiffCommentAttachment({
        path: 'a.ts',
        comment: 'ok',
        lines: [],
      }),
    ).toThrow(/line/i);
  });

  it('expands into agent prompt via attachments', () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-diff-cmt-'));
    mkdirSync(root, { recursive: true });
    const att = buildDiffCommentAttachment({
      path: 'x.ts',
      comment: 'Fix this',
      lines: [{ side: 'add', lineNo: 2, text: 'return 1;' }],
    });
    const result = expandComposerPrompt(root, 'Please address the review note.', {
      attachments: [att],
    });
    expect(result.agentPrompt).toContain('Please address the review note.');
    expect(result.agentPrompt).toContain('Kind: diff-comment');
    expect(result.agentPrompt).toContain('Fix this');
    expect(result.agentPrompt).toContain('+return 1;');
  });
});
