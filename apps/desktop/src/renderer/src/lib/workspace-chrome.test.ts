import { describe, expect, it } from 'vitest';
import { GLOBAL_WORKSPACE_ID } from './global-workspace';
import { repoBasename, workspaceChromeLabels } from './workspace-chrome';

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
    });
  });

  it('still shows a placeholder branch when there is no PR', () => {
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
      task: 'thread/sirius',
    });
  });

  it('labels orchestration chats under Orchestration', () => {
    expect(
      workspaceChromeLabels({
        repoPath: GLOBAL_WORKSPACE_ID,
        worktreePath: GLOBAL_WORKSPACE_ID,
        title: 'Ajax',
        sourceType: 'orchestration',
      }),
    ).toEqual({ project: 'Orchestration', task: 'Ajax' });
  });
});
