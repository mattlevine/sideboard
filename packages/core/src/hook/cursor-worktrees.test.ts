import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasCursorWorktreeSetup, runCursorWorktreeSetup } from './cursor-worktrees.js';

describe('cursor worktrees setup', () => {
  it('detects .cursor/worktrees.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-cursor-'));
    mkdirSync(join(root, '.cursor'));
    writeFileSync(
      join(root, '.cursor', 'worktrees.json'),
      JSON.stringify({ 'setup-worktree': ['echo hi'] }),
    );
    expect(hasCursorWorktreeSetup(root)).toBe(true);
  });

  it('runs setup commands with ROOT_WORKTREE_PATH', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'sideboard-cursor-repo-'));
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-cursor-wt-'));
    mkdirSync(join(repo, '.cursor'));
    writeFileSync(
      join(repo, '.cursor', 'worktrees.json'),
      JSON.stringify({
        'setup-worktree': ['test -n "$ROOT_WORKTREE_PATH" && echo ok'],
      }),
    );
    const lines: string[] = [];
    const result = await runCursorWorktreeSetup(repo, wt, (l) => lines.push(l));
    expect(result.ran).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.source).toContain('.cursor/worktrees.json');
  });
});
