import { describe, expect, it } from 'vitest';
import {
  formatAccountProfilePlaybookLine,
  formatProjectProfilePlaybookLines,
  formatWorkspaceProfileSuffix,
  normalizeAccountRole,
  normalizeAccountRoles,
  normalizeProfileNotes,
  preferTeamsForRole,
  resolveAccountProfile,
  resolveViewerProfile,
  reviewTeamHintsForRoles,
} from './account-profile.js';

describe('account-profile', () => {
  it('accepts one role or several, and drops a combined both value', () => {
    expect(normalizeAccountRoles(['engineering', 'design'])).toEqual([
      'engineering',
      'design',
    ]);
    expect(normalizeAccountRoles([], 'design')).toEqual(['design']);
    expect(normalizeAccountRoles(['engineering', 'engineering', 'nope!!'])).toEqual([
      'engineering',
    ]);
    expect(normalizeAccountRoles(['QA', 'data science'])).toEqual(['qa', 'data-science']);
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
    expect(reviewTeamHintsForRoles(['qa'])).toEqual(['qa-team', 'qa']);
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
    expect(
      formatAccountProfilePlaybookLine(resolveAccountProfile({ roles: ['qa'] })),
    ).toMatch(/QA/);
  });

  it('trims and caps profile notes', () => {
    expect(normalizeProfileNotes('  pick billing  ')).toBe('pick billing');
    expect(normalizeProfileNotes('x'.repeat(2500))).toHaveLength(2000);
    expect(normalizeProfileNotes(12)).toBe('');
  });

  it('lets project roles override account and stacks notes', () => {
    const merged = resolveViewerProfile(
      { roles: ['engineering'], notes: 'Account: assignee=me' },
      { roles: ['design'], notes: 'This repo: design-review' },
    );
    expect(merged.roles).toEqual(['design']);
    expect(merged.rolesFromProject).toBe(true);
    expect(merged.reviewTeamHints).toContain('design-team');
    expect(merged.notes).toBe('Account: assignee=me\nThis repo: design-review');
    expect(formatWorkspaceProfileSuffix(merged)).toMatch(/roles:design/);
    expect(formatWorkspaceProfileSuffix(merged)).toMatch(/design-review/);
  });

  it('inherits account roles when the project has none', () => {
    const merged = resolveViewerProfile(
      { roles: ['engineering', 'product'], notes: 'Unassigned eng tickets' },
      { notes: 'Also the billing board' },
    );
    expect(merged.roles).toEqual(['engineering', 'product']);
    expect(merged.rolesFromProject).toBe(false);
    expect(merged.accountNotes).toBe('Unassigned eng tickets');
    expect(merged.projectNotes).toBe('Also the billing board');
  });

  it('lists only projects that override roles or notes', () => {
    expect(
      formatProjectProfilePlaybookLines([
        { name: 'plain' },
        { name: 'design-app', roleLabels: ['Design'], notes: 'design-review label' },
      ]),
    ).toMatch(/design-app: roles Design\. design-review label/);
  });
});
