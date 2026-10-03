import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_RESULT_STORE_MAX_CHARS } from './error-detail.js';
import {
  executeSlicedFileRead,
  SLICED_READ_DEFAULT_LIMIT,
  slicedReadCustomToolConfig,
} from './sliced-file-read.js';

function tempCwd(): string {
  return mkdtempSync(join(tmpdir(), 'sb-sliced-read-'));
}

describe('executeSlicedFileRead', () => {
  it('returns a small file in full with line numbers', () => {
    const cwd = tempCwd();
    writeFileSync(join(cwd, 'note.md'), 'alpha\nbeta\n');
    const out = executeSlicedFileRead(cwd, { path: 'note.md' });
    expect(out).toMatch(/note\.md \(2 lines/);
    expect(out).toMatch(/     1\|alpha/);
    expect(out).toMatch(/     2\|beta/);
    expect(out).not.toMatch(/truncated/);
  });

  it('defaults to 200 lines and tells the model how to continue', () => {
    const cwd = tempCwd();
    const lines = Array.from({ length: 260 }, (_, i) => `line-${i + 1}`);
    writeFileSync(join(cwd, 'big.txt'), `${lines.join('\n')}\n`);
    const out = executeSlicedFileRead(cwd, { path: 'big.txt' });
    expect(out).toMatch(/260 lines/);
    expect(out).toMatch(/     1\|line-1/);
    expect(out).toMatch(new RegExp(`${SLICED_READ_DEFAULT_LIMIT}\\|line-${SLICED_READ_DEFAULT_LIMIT}`));
    expect(out).not.toMatch(/\|line-201/);
    expect(out).toMatch(/offset=201/);
  });

  it('honors offset and limit', () => {
    const cwd = tempCwd();
    writeFileSync(join(cwd, 'n.txt'), 'a\nb\nc\nd\n');
    const out = executeSlicedFileRead(cwd, { path: 'n.txt', offset: 2, limit: 2 });
    expect(out).toMatch(/     2\|b/);
    expect(out).toMatch(/     3\|c/);
    expect(out).not.toMatch(/\|a/);
    expect(out).not.toMatch(/\|d/);
  });

  it('rejects paths outside the worktree', () => {
    const cwd = tempCwd();
    const out = executeSlicedFileRead(cwd, { path: '../secret.txt' });
    expect(out).toMatch(/outside the worktree/);
  });

  it('rejects a symlink that escapes the worktree', () => {
    const cwd = tempCwd();
    const outside = mkdtempSync(join(tmpdir(), 'sb-sliced-out-'));
    writeFileSync(join(outside, 'secret.txt'), 'nope');
    symlinkSync(join(outside, 'secret.txt'), join(cwd, 'link.txt'));
    const out = executeSlicedFileRead(cwd, { path: 'link.txt' });
    expect(out).toMatch(/outside the worktree/);
  });

  it('refuses a binary file', () => {
    const cwd = tempCwd();
    writeFileSync(join(cwd, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 9]));
    expect(executeSlicedFileRead(cwd, { path: 'blob.bin' })).toMatch(/binary/);
  });

  it('caps a single huge line so one minified file cannot fill the turn', () => {
    const cwd = tempCwd();
    writeFileSync(join(cwd, 'min.js'), `${'x'.repeat(TOOL_RESULT_STORE_MAX_CHARS)}\n`);
    const out = executeSlicedFileRead(cwd, { path: 'min.js' });
    expect(out.length).toBeLessThan(TOOL_RESULT_STORE_MAX_CHARS + 200);
    expect(out).toMatch(/more chars on this line/);
  });
});

describe('slicedReadCustomToolConfig', () => {
  it('exposes execute bound to cwd', () => {
    const cwd = tempCwd();
    writeFileSync(join(cwd, 'a.txt'), 'hi\n');
    const tool = slicedReadCustomToolConfig(cwd);
    expect(tool.description).toMatch(/200 lines/);
    expect(tool.execute({ path: 'a.txt' })).toMatch(/     1\|hi/);
  });
});
