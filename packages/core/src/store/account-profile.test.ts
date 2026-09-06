import { describe, expect, it } from 'vitest';
import {
  foldLegacyRolesIntoNotes,
  formatAccountProfilePlaybookLine,
  formatProjectProfilePlaybookLines,
  formatViewerContextDirective,
  formatViewerContextReminder,
  formatWorkspaceProfileSuffix,
  normalizeProfileNotes,
  resolveAccountProfile,
  resolveViewerProfile,
} from './account-profile.js';

describe('account-profile', () => {
  it('folds leftover role checkboxes into notes once', () => {
    expect(foldLegacyRolesIntoNotes(['engineering', 'design'], undefined, '')).toBe(
      'Roles: Engineering, Design',
    );
    expect(
      foldLegacyRolesIntoNotes(['engineering'], undefined, 'assignee=me'),
    ).toBe('Roles: Engineering. assignee=me');
    expect(
      foldLegacyRolesIntoNotes(['design'], undefined, 'Roles: Design. keep'),
    ).toBe('Roles: Design. keep');
    expect(foldLegacyRolesIntoNotes(['both', 'nope!!'], 'QA', '')).toBe('Roles: QA');
    expect(foldLegacyRolesIntoNotes([], undefined, '  pick billing  ')).toBe(
      'pick billing',
    );
  });

  it('trims and caps profile notes', () => {
    expect(normalizeProfileNotes('  pick billing  ')).toBe('pick billing');
    expect(normalizeProfileNotes('x'.repeat(2500))).toHaveLength(2000);
    expect(normalizeProfileNotes(12)).toBe('');
  });

  it('stacks account then project context', () => {
    const merged = resolveViewerProfile(
      { notes: 'Account: assignee=me' },
      { notes: 'This repo: design-review' },
    );
    expect(merged.accountNotes).toBe('Account: assignee=me');
    expect(merged.projectNotes).toBe('This repo: design-review');
    expect(merged.notes).toBe('Account: assignee=me\nThis repo: design-review');
    expect(formatWorkspaceProfileSuffix(merged)).toMatch(/design-review/);
    expect(formatWorkspaceProfileSuffix(merged)).not.toMatch(/assignee=me/);
  });

  it('folds leftover project roles into that project\'s context', () => {
    const merged = resolveViewerProfile(
      { roles: ['engineering'], notes: 'Unassigned eng tickets' },
      { roles: ['design'], notes: 'Also the billing board' },
    );
    expect(merged.accountNotes).toBe('Roles: Engineering. Unassigned eng tickets');
    expect(merged.projectNotes).toBe('Roles: Design. Also the billing board');
  });

  it('formats a playbook line only when account context is set', () => {
    expect(formatAccountProfilePlaybookLine(resolveAccountProfile({}))).toBe('');
    const line = formatAccountProfilePlaybookLine(
      resolveAccountProfile({ notes: 'Engineering; assignee=me' }),
    );
    expect(line).toMatch(/Account context/);
    expect(line).toMatch(/assignee=me/);
    expect(line).toMatch(/update_viewer_context/);
    expect(line).toMatch(/ask_user/);
  });

  it('lists only projects that have context', () => {
    expect(
      formatProjectProfilePlaybookLines([
        { name: 'plain' },
        { name: 'design-app', notes: 'design-review label' },
      ]),
    ).toMatch(/design-app: design-review label/);
  });

  it('tells worktree agents to confirm before writing context', () => {
    const text = formatViewerContextDirective(
      resolveViewerProfile({ notes: 'Engineering' }, { notes: 'design-review' }),
    );
    expect(text).toMatch(/Account: Engineering/);
    expect(text).toMatch(/This project: design-review/);
    expect(text).toMatch(/ask_user/);
    expect(text).toMatch(/confirmed=true/);
    expect(formatViewerContextReminder()).toMatch(/update_viewer_context/);
    expect(formatViewerContextReminder()).toMatch(/ask_user/);
  });
});
