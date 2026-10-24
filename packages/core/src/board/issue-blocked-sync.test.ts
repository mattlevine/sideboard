import { describe, expect, it } from 'vitest';
import {
  lookupIssueBlockedBy,
  sameIssueBlockedBy,
  sourceTicketRef,
  trackerForSourceTicket,
  type IssueBlockedLookup,
} from './issue-blocked-sync.js';

const connected = { linear: true, abletime: false };

describe('sourceTicketRef', () => {
  it('reads a ticket source and ignores other kinds', () => {
    expect(sourceTicketRef({ sourceType: 'ticket', sourceRef: ' ENG-9 ' })).toBe('ENG-9');
    expect(sourceTicketRef({ sourceType: 'branch', sourceRef: 'ENG-9' })).toBeNull();
    expect(sourceTicketRef({ sourceType: 'ticket', sourceRef: '  ' })).toBeNull();
  });
});

describe('trackerForSourceTicket', () => {
  it('sends Linear keys to Linear when that account is connected', () => {
    expect(trackerForSourceTicket('ENG-88', 'linear', connected)).toBe('linear');
    expect(trackerForSourceTicket('ENG-88', 'github', connected)).toBe('linear');
  });

  it('sends GitHub numbers to GitHub', () => {
    expect(trackerForSourceTicket('#12', 'linear', connected)).toBe('github');
    expect(trackerForSourceTicket('gh-12', 'linear', connected)).toBe('github');
  });

  it('keeps AbleTime keys on AbleTime when that is the preferred source', () => {
    expect(
      trackerForSourceTicket('CRM-232', 'abletime', { linear: true, abletime: true }),
    ).toBe('abletime');
  });

  it('does not invent a tracker when nothing is connected', () => {
    expect(
      trackerForSourceTicket('ENG-88', 'github', { linear: false, abletime: false }),
    ).toBeNull();
  });
});

describe('sameIssueBlockedBy', () => {
  it('ignores order and case', () => {
    expect(sameIssueBlockedBy(['ENG-2', 'ENG-8'], ['eng-8', 'ENG-2'])).toBe(true);
    expect(sameIssueBlockedBy(undefined, [])).toBe(true);
    expect(sameIssueBlockedBy([], ['ENG-2'])).toBe(false);
  });
});

describe('lookupIssueBlockedBy', () => {
  function lookup(partial: Partial<IssueBlockedLookup> = {}): IssueBlockedLookup {
    return {
      preferredSource: () => 'linear',
      linearConnected: () => true,
      abletimeConnected: () => false,
      linear: async () => ['ENG-2'],
      github: async () => ['#4'],
      abletime: async () => ['CRM-1'],
      ...partial,
    };
  }

  it('returns Linear blockers for a ticket worktree', async () => {
    await expect(
      lookupIssueBlockedBy(
        { sourceType: 'ticket', sourceRef: 'ENG-9' },
        lookup(),
      ),
    ).resolves.toEqual(['ENG-2']);
  });

  it('returns an empty list when the ticket was read and nothing blocks it', async () => {
    await expect(
      lookupIssueBlockedBy(
        { sourceType: 'ticket', sourceRef: 'ENG-9' },
        lookup({ linear: async () => [] }),
      ),
    ).resolves.toEqual([]);
  });

  it('keeps the stored list when the tracker call fails', async () => {
    await expect(
      lookupIssueBlockedBy(
        { sourceType: 'ticket', sourceRef: 'ENG-9' },
        lookup({
          linear: async () => {
            throw new Error('offline');
          },
        }),
      ),
    ).resolves.toBeNull();
  });

  it('skips worktrees that are not from a ticket', async () => {
    await expect(
      lookupIssueBlockedBy({ sourceType: 'branch', sourceRef: 'main' }, lookup()),
    ).resolves.toBeNull();
  });
});
