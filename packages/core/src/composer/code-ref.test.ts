import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCodeRefAttachment,
  buildPathRefAttachment,
  codeRefRangeLabel,
  normalizeCodeSelection,
} from './code-ref.js';
import { expandComposerPrompt } from './expand.js';

describe('normalizeCodeSelection', () => {
  it('returns null for an empty caret', () => {
    expect(normalizeCodeSelection(4, 2, 4, 2)).toBeNull();
  });

  it('keeps a mid-line range on one line', () => {
    expect(normalizeCodeSelection(4, 2, 4, 10)).toEqual({ startLine: 4, endLine: 4 });
  });

  it('drops the trailing line when the selection ends at column 1', () => {
    expect(normalizeCodeSelection(10, 1, 13, 1)).toEqual({ startLine: 10, endLine: 12 });
  });

  it('normalizes an upward (RTL) selection', () => {
    expect(normalizeCodeSelection(8, 4, 6, 1)).toEqual({ startLine: 6, endLine: 8 });
  });
});

describe('buildCodeRefAttachment', () => {
  it('formats path, range, and cited snippet', () => {
    const att = buildCodeRefAttachment({
      path: 'src/app.ts',
      startLine: 10,
      endLine: 12,
      text: 'export function foo() {\n  return 1;\n}',
      language: 'typescript',
      id: 'fixed-id',
    });

    expect(att).toEqual({
      id: 'fixed-id',
      name: 'src/app.ts:L10-12',
      kind: 'code-ref',
      path: 'src/app.ts',
      content: expect.stringContaining('Referenced code from `src/app.ts` (L10-12).'),
    });
    expect(att.content).toContain('```typescript');
    expect(att.content).toContain('export function foo() {');
    expect(codeRefRangeLabel(10, 10)).toBe('L10');
  });

  it('rejects empty text or invalid range', () => {
    expect(() =>
      buildCodeRefAttachment({
        path: 'a.ts',
        startLine: 1,
        endLine: 1,
        text: '   ',
      }),
    ).toThrow(/selected text/i);
    expect(() =>
      buildCodeRefAttachment({
        path: 'a.ts',
        startLine: 5,
        endLine: 2,
        text: 'x',
      }),
    ).toThrow(/line range/i);
  });

  it('expands into agent prompt via attachments', () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-code-ref-'));
    mkdirSync(root, { recursive: true });
    const att = buildCodeRefAttachment({
      path: 'x.ts',
      startLine: 2,
      endLine: 2,
      text: 'return 1;',
    });
    const result = expandComposerPrompt(root, 'Explain this snippet.', {
      attachments: [att],
    });
    expect(result.agentPrompt).toContain('Explain this snippet.');
    expect(result.agentPrompt).toContain('Kind: code-ref');
    expect(result.agentPrompt).toContain('return 1;');
    expect(result.agentPrompt).toContain('x.ts');
  });
});

describe('buildPathRefAttachment', () => {
  it('references a whole file', () => {
    const att = buildPathRefAttachment({
      path: 'src/app.ts',
      entry: 'file',
      id: 'fixed-id',
    });
    expect(att).toEqual({
      id: 'fixed-id',
      name: 'src/app.ts',
      kind: 'code-ref',
      path: 'src/app.ts',
      content: expect.stringContaining('Referenced file `src/app.ts`.'),
    });
    expect(att.content).toContain('Read tool');
  });

  it('references a folder with a trailing slash and listing', () => {
    const att = buildPathRefAttachment({
      path: 'apps/desktop/',
      entry: 'dir',
      childPaths: ['apps/desktop/src/App.tsx', 'apps/desktop/package.json'],
      id: 'dir-id',
    });
    expect(att.name).toBe('apps/desktop/');
    expect(att.path).toBe('apps/desktop/');
    expect(att.content).toContain('Referenced folder `apps/desktop/`.');
    expect(att.content).toContain('apps/desktop/src/App.tsx');
  });

  it('expands folder refs into the agent prompt', () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-path-ref-'));
    mkdirSync(root, { recursive: true });
    const att = buildPathRefAttachment({
      path: 'src',
      entry: 'dir',
      childPaths: ['src/a.ts'],
    });
    const result = expandComposerPrompt(root, 'Look here.', { attachments: [att] });
    expect(result.agentPrompt).toContain('Kind: code-ref');
    expect(result.agentPrompt).toContain('src/');
    expect(result.agentPrompt).toContain('src/a.ts');
  });
});
