import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatArtifactDirective,
  formatRenameBranchDirective,
  formatWorktreeDirective,
  loadAgentInstructions,
  withAgentInstructions,
} from './instructions.js';

describe('formatArtifactDirective', () => {
  it('points agents at present_artifact and html fences', () => {
    const text = formatArtifactDirective();
    expect(text).toMatch(/present_artifact/);
    expect(text).toMatch(/```html/);
    expect(text).toMatch(/Never say artifacts are unavailable/i);
  });
});

describe('formatWorktreeDirective', () => {
  it('requires agents to stay in the worktree and avoid the main repo', () => {
    const text = formatWorktreeDirective({
      worktreePath: '/tmp/sideboard/workspaces/app/paris',
      repoPath: '/Users/me/Projects/app',
      branchName: 'thread/paris',
      title: 'Paris FC',
    });
    expect(text).toContain('/tmp/sideboard/workspaces/app/paris');
    expect(text).toContain('/Users/me/Projects/app');
    expect(text).toMatch(/do NOT edit/i);
    expect(text).toMatch(/Stay inside the worktree/i);
    expect(text).toMatch(/Worktree folder nickname/i);
    expect(text).toMatch(/soccer-team worktree nickname/i);
    expect(text).toMatch(/gh pr create --draft -R/i);
  });

  it('pins draft PR create to the origin slug when provided', () => {
    const text = formatWorktreeDirective(
      {
        worktreePath: '/tmp/sideboard/workspaces/app/paris',
        repoPath: '/Users/me/Projects/app',
        branchName: 'thread/paris',
      },
      { githubSlug: 'mattlevine/storycycle-ai' },
    );
    expect(text).toContain('gh pr create --draft -R mattlevine/storycycle-ai');
    expect(text).toMatch(/upstream instead of origin/i);
    expect(text).toMatch(/git push -u origin HEAD/i);
    expect(text).toMatch(/Never push to or open PRs against `upstream`/i);
  });
});

describe('formatRenameBranchDirective', () => {
  it('asks the agent to rename placeholder branches', () => {
    const text = formatRenameBranchDirective({
      worktreePath: '/tmp/sideboard/workspaces/app/paris',
      branchName: 'thread/paris',
    });
    expect(text).toMatch(/git branch -m/i);
    expect(text).toContain('thread/paris');
    expect(text).toContain('paris');
  });

  it('skips renamed task branches', () => {
    expect(
      formatRenameBranchDirective({
        worktreePath: '/tmp/sideboard/workspaces/app/paris',
        branchName: 'fix/panel-width',
      }),
    ).toBeNull();
  });

  it('includes custom rename_branch prompt when provided', () => {
    const text = formatRenameBranchDirective(
      {
        worktreePath: '/tmp/sideboard/workspaces/app/paris',
        branchName: 'thread/paris',
      },
      { customPrompt: 'Use a short kebab-case branch name.' },
    );
    expect(text).toContain('Use a short kebab-case branch name.');
  });
});

describe('loadAgentInstructions', () => {
  it('loads CLAUDE.md and AGENTS.md for claude', () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-instr-'));
    writeFileSync(join(root, 'CLAUDE.md'), '# Claude rules\nUse pnpm.\n');
    writeFileSync(join(root, 'AGENTS.md'), '# Agents\nBe brief.\n');

    const files = loadAgentInstructions(root, 'claude');
    expect(files.map((f) => f.relativePath)).toEqual(['CLAUDE.md', 'AGENTS.md']);
  });
});

describe('withAgentInstructions', () => {
  it('prepends instructions to the prompt', () => {
    const out = withAgentInstructions('Do the thing', [
      { relativePath: 'AGENTS.md', content: 'Be brief.' },
    ]);
    expect(out).toContain('AGENTS.md');
    expect(out).toContain('Be brief.');
    expect(out).toContain('Do the thing');
  });
});
