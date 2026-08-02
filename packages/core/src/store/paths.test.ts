import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoSlug, sideboardWorkspacesDir, worktreesRoot } from './paths.js';

describe('worktreesRoot', () => {
  it('defaults to ~/sideboard/workspaces/<repo-slug>', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-repo-'));
    const wt = worktreesRoot(root);
    expect(wt).toBe(join(sideboardWorkspacesDir(), repoSlug(root)));
    expect(wt.startsWith(join(homedir(), 'sideboard', 'workspaces'))).toBe(true);
  });
});
