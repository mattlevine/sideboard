import { describe, expect, it } from 'vitest';
import { sidebarGitStatusView } from './sidebar-git-status';

describe('sidebarGitStatusView', () => {
  it('hides when there is no branch', () => {
    expect(
      sidebarGitStatusView({
        branchName: '  ',
        dirty: false,
        additions: 0,
        deletions: 0,
        unpushed: 0,
        ready: true,
      }).visible,
    ).toBe(false);
  });

  it('shows uncommitted counts once meta is ready', () => {
    const view = sidebarGitStatusView({
      branchName: 'thread/avispa-fukuoka',
      dirty: true,
      additions: 12,
      deletions: 3,
      unpushed: 1,
      ready: true,
    });
    expect(view.branch).toBe('avispa-fukuoka');
    expect(view.dirty).toBe(true);
    expect(view.additions).toBe(12);
    expect(view.deletions).toBe(3);
    expect(view.unpushed).toBe(1);
    expect(view.title).toContain('Uncommitted +12 −3');
    expect(view.title).toContain('1 unpushed commit');
  });

  it('does not invent a clean tree before meta loads', () => {
    const view = sidebarGitStatusView({
      branchName: 'main',
      dirty: false,
      additions: 0,
      deletions: 0,
      unpushed: 0,
      ready: false,
    });
    expect(view.ready).toBe(false);
    expect(view.dirty).toBe(false);
    expect(view.title).toContain('Loading git status');
  });

  it('says the working tree is clean', () => {
    const view = sidebarGitStatusView({
      branchName: 'main',
      dirty: false,
      additions: 0,
      deletions: 0,
      unpushed: 2,
      ready: true,
    });
    expect(view.dirty).toBe(false);
    expect(view.title).toContain('Working tree clean');
    expect(view.title).toContain('2 unpushed commits');
  });
});
