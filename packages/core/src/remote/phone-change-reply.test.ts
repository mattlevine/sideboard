import { describe, expect, it } from 'vitest';
import { emptyChangesNote, staleChangeReply } from '../../../../apps/mobile/phone-pane-types.ts';

describe('staleChangeReply', () => {
  it('drops a reply for a different commit, including All Commits versus one commit', () => {
    expect(staleChangeReply({ scope: 'commits', commitSha: null }, { scope: 'commits', commitSha: 'abc' })).toBe(true);
    expect(staleChangeReply({ scope: 'commits', commitSha: 'abc' }, { scope: 'commits', commitSha: null })).toBe(true);
    expect(staleChangeReply({ scope: 'commits', commitSha: 'abc' }, { scope: 'commits', commitSha: 'def' })).toBe(true);
    expect(staleChangeReply({ scope: 'commits', commitSha: null }, { scope: 'uncommitted', commitSha: null })).toBe(true);
  });

  it('keeps a reply for the same filter, and an older Mac that omits the scope', () => {
    expect(staleChangeReply({ scope: 'commits', commitSha: null }, { scope: 'commits', commitSha: null })).toBe(false);
    expect(staleChangeReply({ scope: 'commits', commitSha: 'abc' }, { scope: 'commits', commitSha: 'abc' })).toBe(false);
    expect(staleChangeReply({ scope: 'uncommitted', commitSha: null }, { commitSha: null })).toBe(false);
  });
});

describe('emptyChangesNote', () => {
  it('describes an empty diff, not a branch with no commits', () => {
    expect(emptyChangesNote('commits', null, 'main')).toBe('No changes vs main');
    expect(emptyChangesNote('commits', 'abc1234', 'main')).toBe('No changes in this commit');
    expect(emptyChangesNote('commits')).toBe('No changes vs the branch base');
    expect(emptyChangesNote('uncommitted')).toBe('No uncommitted changes');
  });
});
