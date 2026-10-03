import { describe, expect, it } from 'vitest';
import { GLOBAL_WORKSPACE_ID } from './global-workspace';
import {
  repoBasename,
  workspaceChromeCrumbs,
  workspaceChromeLabels,
} from './workspace-chrome';

describe('repoBasename', () => {
  it('uses the last path segment', () => {
    expect(repoBasename('/Users/me/Projects/brightsy-ai')).toBe('brightsy-ai');
  });
});

describe('workspaceChromeLabels', () => {
  it('shows the PR title when the thread has one', () => {
    expect(
      workspaceChromeLabels({
        repoPath: '/Users/me/Projects/brightsy-ai',
        worktreePath: '/Users/me/sideboard/workspaces/brightsy-ai/sirius',
        title: 'Review request',
        sourceType: 'branch',
        branchName: 'matt/review-workspace-changes',
        prTitle: 'Review workspace changes',
      }),
    ).toEqual({
      project: 'brightsy-ai',
      task: 'Review workspace changes',
      agent: 'Review request',
    });
  });

  it('falls back to the branch name when there is no PR', () => {
    expect(
      workspaceChromeLabels({
        repoPath: '/Users/me/Projects/sideboard',
        worktreePath: '/Users/me/sideboard/workspaces/sideboard/sirius',
        title: 'Sirius',
        sourceType: 'branch',
        branchName: 'matt/workspace-chrome-tabs',
      }),
    ).toEqual({
      project: 'sideboard',
      task: 'matt/workspace-chrome-tabs',
      agent: 'Sirius',
    });
  });

  it('names a placeholder worktree after the soccer nickname, not the git ref', () => {
    expect(
      workspaceChromeLabels({
        repoPath: '/Users/me/Projects/sideboard',
        worktreePath: '/Users/me/sideboard/workspaces/sideboard/sirius',
        title: 'Sirius',
        sourceType: 'branch',
        branchName: 'thread/sirius',
      }),
    ).toEqual({
      project: 'sideboard',
      task: 'Sirius',
      agent: 'New agent',
    });
  });

  it('keeps the worktree on the PR and the agent on its purpose', () => {
    expect(
      workspaceChromeLabels({
        repoPath: '/Users/me/Projects/sideboard',
        worktreePath: '/wt/lens',
        title: 'feat: replace full-page spinner',
        sourceType: 'branch',
        branchName: 'feat/replace-spinner',
        prTitle: 'feat: replace full-page spinner',
      }),
    ).toEqual({
      project: 'sideboard',
      task: 'feat: replace full-page spinner',
      agent: 'Lens',
    });
  });

  it('labels orchestration chats under Orchestration with no worktree', () => {
    expect(
      workspaceChromeLabels({
        repoPath: GLOBAL_WORKSPACE_ID,
        worktreePath: GLOBAL_WORKSPACE_ID,
        title: 'Ajax',
        sourceType: 'orchestration',
      }),
    ).toEqual({ project: 'Orchestration', task: null, agent: 'Ajax' });
  });

  it('does not use Orchestration as both project and agent', () => {
    expect(
      workspaceChromeLabels({
        repoPath: GLOBAL_WORKSPACE_ID,
        worktreePath: GLOBAL_WORKSPACE_ID,
        title: 'Orchestration',
        sourceType: 'orchestration',
      }),
    ).toEqual({ project: 'Orchestration', task: null, agent: 'New agent' });
  });
});

describe('workspaceChromeCrumbs', () => {
  it('is project > worktree > agent', () => {
    expect(
      workspaceChromeCrumbs({
        project: 'sideboard',
        task: 'feat: replace full-page spinner',
        agent: 'Add dark mode to settings',
      }).map((c) => c.label),
    ).toEqual([
      'sideboard',
      'feat: replace full-page spinner',
      'Add dark mode to settings',
    ]);
  });

  it('is project > agent when orchestration has no worktree', () => {
    expect(
      workspaceChromeCrumbs({
        project: 'Orchestration',
        task: null,
        agent: 'Lanús',
      }).map((c) => `${c.kind}:${c.label}`),
    ).toEqual(['project:Orchestration', 'agent:Lanús']);
  });

  it('does not invent an Orchestration worktree crumb', () => {
    expect(
      workspaceChromeCrumbs({
        project: 'Orchestration',
        task: 'Orchestration',
        agent: 'Kyoto Sanga',
      }).map((c) => `${c.kind}:${c.label}`),
    ).toEqual(['project:Orchestration', 'agent:Kyoto Sanga']);
  });
});
