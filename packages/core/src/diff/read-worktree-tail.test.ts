import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readWorktreeFileTail } from './read-worktree-tail.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readWorktreeFileTail', () => {
  it('returns the end of a file larger than the byte cap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sideboard-tail-'));
    dirs.push(dir);
    const lines = Array.from({ length: 400 }, (_, i) => `line-${i}-${'x'.repeat(40)}`);
    writeFileSync(join(dir, 'job.log'), `${lines.join('\n')}\n`);

    const r = readWorktreeFileTail(dir, 'job.log', 500);
    expect(r.truncated).toBe(true);
    expect(r.content.startsWith('line-0-')).toBe(false);
    expect(r.content).toContain('line-399-');
    expect(r.content.startsWith('line-')).toBe(true);
  });

  it('returns a short file whole', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sideboard-tail-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'job.log'), 'only line\n');
    const r = readWorktreeFileTail(dir, 'job.log');
    expect(r.truncated).toBe(false);
    expect(r.content).toBe('only line\n');
  });
});
