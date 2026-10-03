import { describe, expect, it } from 'vitest';
import {
  allocateTeamName,
  FAMOUS_SOCCER_TEAMS,
  lookupSoccerTeam,
  takenSlugsFromThread,
  teamNameFromSlug,
  teamSlugFromName,
} from './teams.js';
import {
  agentNicknameFromWorktreePath,
  isWorktreeIdentityTitle,
  ticketSlugForBranch,
  worktreeAnchorLabel,
  worktreeSlugForTicket,
} from './worktree-labels.js';
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

  it('strips a leading ticket id so the soccer nickname still shows', () => {
    expect(teamNameFromSlug('eng-12-ajax')).toBe('Ajax');
    expect(teamNameFromSlug('thread/44-west-ham')).toBe('West Ham');
    expect(teamNameFromSlug('eng-12-ajax-2')).toBe('Ajax 2');
  });
});

describe('ticketSlugForBranch', () => {
  it('normalizes Linear, GitHub, and fallback identifiers', () => {
    expect(ticketSlugForBranch('ENG-12')).toBe('eng-12');
    expect(ticketSlugForBranch('#44')).toBe('44');
    expect(ticketSlugForBranch('44')).toBe('44');
    expect(ticketSlugForBranch('  Task 99  ')).toBe('task-99');
    expect(ticketSlugForBranch('')).toBeNull();
  });
});

describe('worktreeSlugForTicket', () => {
  it('prefixes the soccer slug with the ticket id', () => {
    expect(worktreeSlugForTicket('ENG-12', 'ajax')).toBe('eng-12-ajax');
    expect(worktreeSlugForTicket('#44', 'thread/west-ham')).toBe('44-west-ham');
    expect(worktreeSlugForTicket('', 'ajax')).toBe('ajax');
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
        branchName: 'west-ham',
        worktreePath: '/Users/me/sideboard/workspaces/sideboard/west-ham',
      }),
    ).toBe('West Ham');
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

describe('worktreeAnchorLabel', () => {
  it('prefers a PR title and keeps the branch as subtitle', () => {
    expect(
      worktreeAnchorLabel([
        {
          branchName: 'fix/eu-promo-checkout',
          worktreePath: '/wt/eu-promo',
          createdAt: '2026-01-01T00:00:00.000Z',
          prTitle: 'eu-promo-checkout',
        },
        {
          branchName: 'fix/eu-promo-checkout',
          worktreePath: '/wt/eu-promo',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ]),
    ).toEqual({
      title: 'eu-promo-checkout',
      subtitle: 'fix/eu-promo-checkout',
    });
  });

  it('uses the soccer nickname for placeholder branches, not the raw ref', () => {
    expect(
      worktreeAnchorLabel([
        {
          branchName: 'lens',
          worktreePath: '/wt/lens',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          branchName: 'lens',
          worktreePath: '/wt/lens',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ]),
    ).toEqual({ title: 'Lens', subtitle: null });
    expect(
      worktreeAnchorLabel([
        {
          branchName: 'thread/lens',
          worktreePath: '/wt/lens',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ).toEqual({ title: 'Lens', subtitle: null });
  });

  it('uses a real git branch as the title when there is no PR', () => {
    expect(
      worktreeAnchorLabel([
        {
          branchName: 'feature/checkout-flow-v2',
          worktreePath: '/wt/checkout-flow-v2',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ).toEqual({ title: 'feature/checkout-flow-v2', subtitle: null });
  });
});

describe('isWorktreeIdentityTitle', () => {
  it('treats a truncated PR copy as the worktree', () => {
    expect(
      isWorktreeIdentityTitle('feat: replace full-page spinn', [
        'feat: replace full-page spinner',
      ]),
    ).toBe(true);
  });

  it('does not treat a distinct purpose name as the worktree', () => {
    expect(
      isWorktreeIdentityTitle('Add dark mode to settings', [
        'feat: replace full-page spinner',
      ]),
    ).toBe(false);
  });
});

describe('agentNicknameFromWorktreePath', () => {
  it('returns the soccer nickname for a club folder', () => {
    expect(agentNicknameFromWorktreePath('/wt/lens')).toBe('Lens');
  });

  it('returns null when the folder is not a club', () => {
    expect(agentNicknameFromWorktreePath('/wt/feat-replace-spinner')).toBeNull();
  });
});

describe('takenSlugsFromThread', () => {
  it('includes title, branch, and worktree directory slugs', () => {
    expect(
      takenSlugsFromThread({
        title: 'West Ham',
        branchName: 'thread/west-ham',
        worktreePath: '/Users/me/sideboard/workspaces/sideboard/west-ham',
      }).sort(),
    ).toEqual(['west-ham']);
  });

  it('still reserves the worktree slug when the title is not a club', () => {
    expect(
      takenSlugsFromThread({
        title: 'Untitled',
        branchName: 'thread/monaco',
        worktreePath: '/Users/me/sideboard/workspaces/brightsy-ai/monaco',
      }).sort(),
    ).toEqual(['monaco']);
  });

  it('reserves the soccer token from a ticket-prefixed dir and branch', () => {
    expect(
      takenSlugsFromThread({
        title: 'ENG-12 login',
        branchName: 'thread/eng-12-ajax',
        worktreePath: '/Users/me/sideboard/workspaces/sideboard/eng-12-ajax',
      }).sort(),
    ).toEqual(['ajax', 'eng-12-ajax']);
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

  it('does not reuse a soccer token already used under a ticket prefix', () => {
    const taken = takenSlugsFromThread({
      branchName: 'thread/eng-12-ajax',
      worktreePath: '/tmp/eng-12-ajax',
    });
    const others = FAMOUS_SOCCER_TEAMS.map((t) => t.slug).filter((s) => s !== 'ajax');
    const team = allocateTeamName([...others, ...taken], () => 0);
    expect(team.slug).not.toBe('ajax');
  });

  it('never returns a taken slug', () => {
    const taken = ['monaco', 'thread/west-ham', 'Ajax'];
    for (let i = 0; i < 20; i++) {
      const team = allocateTeamName(taken, () => i / 20);
      expect(team.slug).not.toBe('monaco');
      expect(team.slug).not.toBe('west-ham');
    }
  });

  it('includes location and league on allocated teams', () => {
    const taken = new Set(FAMOUS_SOCCER_TEAMS.slice(1).map((t) => t.slug));
    const team = allocateTeamName(taken, () => 0);
    expect(team.location).toBeTruthy();
    expect(team.league).toBeTruthy();
    expect(team.location).not.toBe('Unknown');
  });

  it('lookupSoccerTeam resolves title to location and league', () => {
    expect(lookupSoccerTeam('West Ham')).toMatchObject({
      name: 'West Ham',
      slug: 'west-ham',
      location: 'London, England',
      league: 'Premier League',
    });
  });
});
