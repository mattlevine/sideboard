import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatArtifactDirective,
  formatLongRunningDirective,
  formatLongRunningReminder,
  formatPrGateDirective,
  formatProcessGuideDirective,
  formatRenameBranchDirective,
  formatUiReminder,
  formatIssueToolsDirective,
  formatIssueToolsReminder,
  formatWorktreeDirective,
  formatWorktreeReminder,
  issueTicketFromThread,
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
    expect(text).toMatch(/blocked on choosing|concrete options/i);
    expect(text).toMatch(/hello|greetings/i);
    expect(text).toMatch(/```html/);
    expect(text).toMatch(/type=log/);
    expect(text).toMatch(/new lines only|append/i);
    expect(text).toMatch(/Never say artifacts, CMS UI, or the Files column are unavailable/i);
    expect(text).toMatch(/Do not unprompted-duplicate|markdown table/i);
    expect(text).toMatch(/editable|asks for an editable/i);
  });
});

describe('formatUiReminder', () => {
  it('reminds resumed turns about the side column and ask_user picker', () => {
    const text = formatUiReminder();
    expect(text).toMatch(/present_artifact/);
    expect(text).toMatch(/present_schema/);
    expect(text).toMatch(/present_files/);
    expect(text).toMatch(/ask_user/);
    expect(text).toMatch(/hello|check-in|what next/i);
    expect(text).toMatch(/reply in chat/i);
    expect(text).toMatch(/Do not say artifacts\/CMS UI are unavailable/i);
    expect(text).toMatch(/markdown table is enough|present_schema if they ask to edit/i);
    expect(text).toMatch(/not both for the same document/i);
    expect(text).toMatch(/type=log appends/);
  });
});

describe('formatLongRunningDirective', () => {
  it('tells every worktree agent to detach, wait, and log', () => {
    const text = formatLongRunningDirective({
      scriptPath: '/abs/detached-job.js',
    });
    expect(text).toMatch(/Long-running jobs/);
    expect(text).toContain('node "/abs/detached-job.js"');
    expect(text).toMatch(/start <id>/);
    expect(text).toMatch(/present_artifact/);
    expect(text).toMatch(/type=log/);
    expect(text).toMatch(/\/long-running/);
    expect(text).toMatch(/Do not ask the human to poll/);
    expect(text).toMatch(/\.context\/\.sideboard\/detached-jobs/);
  });
});

describe('formatLongRunningReminder', () => {
  it('repeats the helper path so resume still works', () => {
    const text = formatLongRunningReminder({
      scriptPath: '/abs/detached-job.js',
    });
    expect(text).toContain('node "/abs/detached-job.js"');
    expect(text).toMatch(/present_artifact type=log/);
    expect(text).toMatch(/Do not ask the human to poll/);
  });
});

describe('formatPrGateDirective', () => {
  it('enters a watch-fix-push loop only when a goal is given', () => {
    const text = formatPrGateDirective();
    expect(text).toMatch(/If a goal is given/);
    expect(text).toMatch(/not after every push/);
    expect(text).toMatch(/watch-fix-push/);
    expect(text).toMatch(/Greptile 5\/5/);
    expect(text).toMatch(/gh pr checks --watch/);
    expect(text).toMatch(/5\/5 and zero unresolved/);
  });
});

describe('formatProcessGuideDirective', () => {
  it('sends new skills to .claude/skills so native agents see them', () => {
    const text = formatProcessGuideDirective();
    expect(text).toMatch(/\.claude\/skills\/<kebab-name>\/SKILL\.md/);
    expect(text).toMatch(/\/long-running/);
    expect(text).toMatch(/graph-engineering/);
    expect(text).toMatch(/\/graph-engineering/);
    expect(text).toMatch(/Do not write new skills under `\.sideboard\/skills\/?`/);
    expect(text).toMatch(/Do not create a review skill/);
    expect(text).toMatch(/that folder only/);
    expect(text).toMatch(/attach/);
    expect(text).toMatch(/AGENTS\.md/);
    expect(text).toMatch(/\.claude\/skills\/review\/SKILL\.md/);
    expect(text).toMatch(/\.context\/review\.md/);
    expect(text).toMatch(/\.sideboard\/review\.md/);
  });
});

describe('issueTicketFromThread', () => {
  it('maps GitHub and keyed ticket refs', () => {
    expect(issueTicketFromThread({ sourceType: 'ticket', sourceRef: '#12' })).toEqual({
      id: '#12',
      provider: 'github',
    });
    expect(
      issueTicketFromThread({ sourceType: 'ticket', sourceRef: 'ENG-9' }, 'linear'),
    ).toEqual({ id: 'ENG-9', provider: 'linear' });
    expect(
      issueTicketFromThread({ sourceType: 'ticket', sourceRef: 'CRM-232' }, 'abletime'),
    ).toEqual({ id: 'CRM-232', provider: 'abletime' });
    expect(issueTicketFromThread({ sourceType: 'branch', sourceRef: 'ENG-9' })).toBeNull();
  });
});

describe('formatIssueToolsDirective', () => {
  it('covers Linear, GitHub, and AbleTime Account tools', () => {
    const text = formatIssueToolsDirective({
      linear: true,
      abletime: true,
      ticketId: 'ENG-9',
      ticketProvider: 'linear',
    });
    expect(text).toMatch(/linear_get_issue/);
    expect(text).toMatch(/github_comment/);
    expect(text).toMatch(/abletime_update_task/);
    expect(text).toMatch(/vendor issue MCP/);
    expect(text).toMatch(/ENG-9/);
    expect(text).toMatch(/Do not ask the user to `claude mcp login`/);
  });
});

describe('formatIssueToolsReminder', () => {
  it('names connected Sideboard issue tools', () => {
    const text = formatIssueToolsReminder({
      linear: true,
      abletime: false,
      ticketId: '#4',
      ticketProvider: 'github',
    });
    expect(text).toMatch(/linear_\*/);
    expect(text).toMatch(/github_\*/);
    expect(text).not.toMatch(/abletime_\*/);
    expect(text).toMatch(/#4/);
  });
});

describe('formatWorktreeReminder', () => {
  it('is a short isolation line for resumed turns', () => {
    const text = formatWorktreeReminder();
    expect(text.length).toBeLessThan(420);
    expect(text).toMatch(/stay in this cwd/i);
    expect(text).toMatch(/origin/i);
    expect(text).toMatch(/upstream/i);
    expect(text).toMatch(/If a goal is given/);
    expect(text).toMatch(/do not watch after every push/i);
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
    expect(text).toMatch(/body-file/);
    expect(text).toMatch(/65,536/);
    expect(text).toMatch(/upstream instead of origin/i);
    expect(text).toMatch(/git push -u origin HEAD/i);
    expect(text).toMatch(/Keychain/);
    expect(text).toMatch(/already authenticate/);
    expect(text).toMatch(/Do not set GitHub token environment variables/);
    expect(text).not.toMatch(/GH_TOKEN/);
    expect(text).toMatch(/Never push to or open PRs against `upstream`/i);
    expect(text).toMatch(/Commit and push\./);
    expect(text).toMatch(/If a goal is given/);
    expect(text).toMatch(/watch-fix-push/);
    expect(text).toMatch(/Greptile 5\/5/);
    expect(text).toMatch(/not after every push/);
    expect(text).toMatch(/Merge PR\./);
    expect(text).toMatch(/Do not merge the PR unless/);
    expect(text).toMatch(/gh stack merge/);
    expect(text).toMatch(/Short git requests/i);
    expect(text).toMatch(/Git authentication \(Settings → Git mode: auto\)/);
    expect(text).not.toMatch(/GitHub app/i);
    expect(text).toMatch(/\.claude\/skills\/<kebab-name>\/SKILL\.md/);
    expect(text).toMatch(/\/long-running/);
    expect(text).toMatch(/graph-engineering/);
    expect(text).toMatch(/Do not write new skills under `\.sideboard\/skills\/?`/);
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
    expect(text).toMatch(/already authenticate/);
    expect(text).toMatch(/Do not set GitHub token environment variables/);
    expect(text).not.toMatch(/GH_TOKEN/);
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
