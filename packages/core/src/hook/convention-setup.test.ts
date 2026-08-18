import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findConventionSetup, hasConventionSetup } from './convention-setup.js';

describe('findConventionSetup', () => {
  it('finds script/setup in the worktree', () => {
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-conv-'));
    mkdirSync(join(wt, 'script'));
    writeFileSync(join(wt, 'script', 'setup'), '#!/bin/bash\necho hi\n');
    const found = findConventionSetup(wt);
    expect(found?.relPath).toBe('script/setup');
    expect(found?.source).toBe('script/setup (worktree)');
    expect(hasConventionSetup(wt)).toBe(true);
  });

  it('prefers worktree over main repo', () => {
    const repo = mkdtempSync(join(tmpdir(), 'sideboard-conv-repo-'));
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-conv-wt-'));
    mkdirSync(join(repo, 'bin'));
    mkdirSync(join(wt, 'script'));
    writeFileSync(join(repo, 'bin', 'setup'), 'echo repo\n');
    writeFileSync(join(wt, 'script', 'setup'), 'echo wt\n');
    expect(findConventionSetup(wt, repo)?.relPath).toBe('script/setup');
  });

  it('falls back to main repo when the worktree has none', () => {
    const repo = mkdtempSync(join(tmpdir(), 'sideboard-conv-repo-'));
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-conv-wt-'));
    mkdirSync(join(repo, 'bin'));
    writeFileSync(join(repo, 'bin', 'setup'), 'echo repo\n');
    expect(findConventionSetup(wt, repo)).toMatchObject({
      relPath: 'bin/setup',
      source: 'bin/setup (main repo)',
    });
  });

  it('ignores directories named setup', () => {
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-conv-dir-'));
    mkdirSync(join(wt, 'script'));
    mkdirSync(join(wt, 'script', 'setup'));
    expect(findConventionSetup(wt)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-conv-none-'));
    expect(findConventionSetup(wt)).toBeNull();
    expect(hasConventionSetup(wt)).toBe(false);
  });
});
