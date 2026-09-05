import { describe, expect, it } from 'vitest';
import {
  formatAccountProfilePlaybookLine,
  normalizeAccountRole,
  normalizeAccountRoles,
  preferTeamsForRole,
  resolveAccountProfile,
  reviewTeamHintsForRoles,
} from './account-profile.js';

describe('account-profile', () => {
  it('accepts one role or several, and drops a combined both value', () => {
    expect(normalizeAccountRoles(['engineering', 'design'])).toEqual([
      'engineering',
      'design',
    ]);
    expect(normalizeAccountRoles([], 'design')).toEqual(['design']);
    expect(normalizeAccountRoles(['engineering', 'engineering', 'nope'])).toEqual([
      'engineering',
    ]);
    expect(normalizeAccountRole('both')).toBeUndefined();
    expect(normalizeAccountRoles(['both'])).toEqual([]);
    expect(normalizeAccountRoles(['engineering', 'both', 'design'])).toEqual([
      'engineering',
      'design',
    ]);
  });

  it('unions team hints for every selected role', () => {
    expect(reviewTeamHintsForRoles(['engineering'])).toContain('engineering-team');
    expect(reviewTeamHintsForRoles(['design'])).toContain('design-team');
    expect(reviewTeamHintsForRoles(['engineering', 'design'])).toEqual(
      expect.arrayContaining(['engineering-team', 'design-team']),
    );
  });

  it('keeps only viewer teams that match the selected roles', () => {
    expect(
      preferTeamsForRole(
        ['engineering-team', 'design-team'],
        reviewTeamHintsForRoles(['engineering']),
      ),
    ).toEqual(['engineering-team']);
    expect(
      preferTeamsForRole(
        ['engineering-team', 'design-team'],
        reviewTeamHintsForRoles(['engineering', 'design']),
      ),
    ).toEqual(['engineering-team', 'design-team']);
  });

  it('formats a playbook line only when roles are set', () => {
    expect(formatAccountProfilePlaybookLine(resolveAccountProfile({}))).toBe('');
    const line = formatAccountProfilePlaybookLine(
      resolveAccountProfile({ roles: ['engineering', 'design'] }),
    );
    expect(line).toMatch(/Engineering, Design/);
    expect(line).toMatch(/individual reviewer/);
    expect(line).not.toMatch(/\bboth\b/i);
  });
});
