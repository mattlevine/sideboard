import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatArtifactDirective,
  formatProcessGuideDirective,
  formatRenameBranchDirective,
  formatUiReminder,
  formatWorktreeDirective,
  formatWorktreeReminder,
  loadAgentInstructions,
  withAgentInstructions,
} from './instructions.js';

describe('formatArtifactDirective', () => {
  it('points agents at present_artifact, present_schema, present_files, ask_user, and html fences', () => {
    const text = formatArtifactDirective();
    expect(text).toMatch(/present_artifact/);
    expect(text).toMatch(/present_schema/);
    expect(text).toMatch(/present_files/);
    expect(text).toMatch(/ask_user/);
    expect(text).toMatch(/any mode|not only Plan/i);
    expect(text).toMatch(/```html/);
    expect(text).toMatch(/Never say artifacts, CMS UI, or the Files column are unavailable/i);
  });
});

describe('formatUiReminder', () => {
  it('reminds resumed turns about the side column and ask_user picker', () => {
    const text = formatUiReminder();
    expect(text).toMatch(/present_artifact/);
    expect(text).toMatch(/present_schema/);
    expect(text).toMatch(/present_files/);
    expect(text).toMatch(/ask_user/);
    expect(text).toMatch(/any mode/i);
    expect(text).toMatch(/Do not say artifacts\/CMS UI are unavailable/i);
  });
});

describe('formatProcessGuideDirective', () => {
  it('sends new skills to .claude/skills so native agents see them', () => {
    const text = formatProcessGuideDirective();
    expect(text).toMatch(/\.claude\/skills\/<kebab-name>\/SKILL\.md/);
    expect(text).toMatch(/graph-engineering/);
    expect(text).toMatch(/\/graph-engineering/);
    expect(text).toMatch(/Do not write new skills under `\.sideboard\/skills`/);
    expect(text).toMatch(/attach/);
    expect(text).toMatch(/AGENTS\.md/);
    expect(text).toMatch(/one-off/);
  });
});

describe('formatWorktreeReminder', () => {
  it('is a short isolation line for resumed turns', () => {
    const text = formatWorktreeReminder();
    expect(text.length).toBeLessThan(220);
    expect(text).toMatch(/stay in this cwd/i);
    expect(text).toMatch(/origin/i);
    expect(text).toMatch(/upstream/i);
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
    expect(text).toMatch(/Keychain/);
    expect(text).toMatch(/GH_TOKEN/);
    expect(text).toMatch(/Never push to or open PRs against `upstream`/i);
    expect(text).toMatch(/Commit and push\./);
    expect(text).toMatch(/Merge PR\./);
    expect(text).toMatch(/Do not merge the PR unless/);
    expect(text).toMatch(/gh stack merge/);
    expect(text).toMatch(/Short git requests/i);
    expect(text).toMatch(/Git authentication \(Account → GitHub mode: auto\)/);
    expect(text).not.toMatch(/GitHub app/i);
    expect(text).toMatch(/\.claude\/skills\/<kebab-name>\/SKILL\.md/);
    expect(text).toMatch(/graph-engineering/);
    expect(text).toMatch(/Do not write new skills under `\.sideboard\/skills`/);
    expect(text).toMatch(/Skip a guide for a one-off/);
  });

  it('injects gh-mode instructions instead of the SSH fallback', () => {
    const text = formatWorktreeDirective(
      {
        worktreePath: '/tmp/sideboard/workspaces/app/paris',
        repoPath: '/Users/me/Projects/app',
        branchName: 'thread/paris',
      },
      { githubSlug: 'acme/app', gitAuthMode: 'gh' },
    );
    expect(text).toMatch(/mode: gh CLI/);
    expect(text).toMatch(/GH_TOKEN/);
    expect(text).not.toMatch(/Permission denied \(publickey\)/);
    expect(text).not.toMatch(/GitHub app/i);
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
  it('loads CLAUDE.md and AGENTS.md for claude when they differ', () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-instr-'));
    writeFileSync(join(root, 'CLAUDE.md'), '# Claude rules\nUse pnpm.\n');
    writeFileSync(join(root, 'AGENTS.md'), '# Agents\nBe brief.\n');

    const files = loadAgentInstructions(root, 'claude');
    expect(files.map((f) => f.relativePath)).toEqual(['CLAUDE.md', 'AGENTS.md']);
  });

  it('skips AGENTS.md when it matches CLAUDE.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-instr-same-'));
    const body = '# Sideboard Orchestration\nFollow MCP.\n';
    writeFileSync(join(root, 'CLAUDE.md'), body);
    writeFileSync(join(root, 'AGENTS.md'), `${body}\n`);

    const files = loadAgentInstructions(root, 'claude');
    expect(files.map((f) => f.relativePath)).toEqual(['CLAUDE.md']);
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
