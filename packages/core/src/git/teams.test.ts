import { describe, expect, it } from 'vitest';
import {
  allocateTeamName,
  FAMOUS_SOCCER_TEAMS,
  teamNameFromSlug,
  teamSlugFromName,
} from './teams.js';
import { worktreeDisplayLabel, worktreeDisplayLabelForGroup } from './worktree.js';

describe('teamNameFromSlug', () => {
  it('maps known team slugs to display names', () => {
    expect(teamNameFromSlug('west-ham')).toBe('West Ham');
    expect(teamNameFromSlug('thread/west-ham')).toBe('West Ham');
  });

  it('handles suffixed slugs when the pool is exhausted', () => {
    expect(teamNameFromSlug('ajax-2')).toBe('Ajax 2');
  });

  it('title-cases unknown slugs', () => {
    expect(teamNameFromSlug('my-custom-work')).toBe('My Custom Work');
  });
});

describe('teamSlugFromName', () => {
  it('maps known display names to slugs', () => {
    expect(teamSlugFromName('West Ham')).toBe('west-ham');
    expect(teamSlugFromName('Paris Saint-Germain')).toBe('psg');
  });

  it('handles suffixed display names', () => {
    expect(teamSlugFromName('Ajax 2')).toBe('ajax-2');
  });

  it('returns null for unknown titles', () => {
    expect(teamSlugFromName('Context manager')).toBeNull();
  });
});

describe('worktreeDisplayLabel', () => {
  it('shows soccer-team nickname while branch is still a placeholder', () => {
    expect(
      worktreeDisplayLabel({
        branchName: 'thread/west-ham',
        worktreePath: '/Users/me/sideboard/workspaces/sideboard/west-ham',
      }),
    ).toBe('West Ham');
  });

  it('shows the renamed task branch (Conductor-style)', () => {
    expect(
      worktreeDisplayLabel({
        branchName: 'fix/panel-width',
        worktreePath: '/Users/me/sideboard/workspaces/sideboard/west-ham',
      }),
    ).toBe('fix/panel-width');
  });

  it('prefers PR title over branch', () => {
    expect(
      worktreeDisplayLabel({
        branchName: 'fix/panel-width',
        worktreePath: '/Users/me/sideboard/workspaces/sideboard/west-ham',
        prTitle: 'Fix panel width persistence',
      }),
    ).toBe('Fix panel width persistence');
  });

  it('falls back to worktree dir when branch slug is empty', () => {
    expect(
      worktreeDisplayLabel({
        branchName: '',
        worktreePath: '/Users/me/sideboard/workspaces/sideboard/ajax-2',
      }),
    ).toBe('Ajax 2');
  });
});

describe('worktreeDisplayLabelForGroup', () => {
  it('uses the oldest tab binding and ignores tab order / selection', () => {
    expect(
      worktreeDisplayLabelForGroup([
        {
          branchName: 'thread/west-ham',
          worktreePath: '/Users/me/sideboard/workspaces/sideboard/west-ham',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          branchName: 'thread/west-ham',
          worktreePath: '/Users/me/sideboard/workspaces/sideboard/west-ham',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ]),
    ).toBe('West Ham');
  });
});

describe('allocateTeamName', () => {
  it('picks an unused team', () => {
    const taken = new Set(FAMOUS_SOCCER_TEAMS.slice(1).map((t) => t.slug));
    const team = allocateTeamName(taken, () => 0);
    expect(team).toEqual(FAMOUS_SOCCER_TEAMS[0]);
  });

  it('ignores thread/ prefix on taken branch names', () => {
    const team = allocateTeamName(['thread/liverpool', 'arsenal'], () => 0);
    expect(team.slug).not.toBe('liverpool');
    expect(team.slug).not.toBe('arsenal');
  });

  it('suffixes when the pool is exhausted', () => {
    const taken = new Set(FAMOUS_SOCCER_TEAMS.map((t) => t.slug));
    const team = allocateTeamName(taken, () => 0);
    expect(team.slug).toBe(`${FAMOUS_SOCCER_TEAMS[0]!.slug}-2`);
    expect(team.name).toBe(`${FAMOUS_SOCCER_TEAMS[0]!.name} 2`);
  });
});
