import { describe, expect, it } from 'vitest';
import { phoneHeaderFrom, phonePrPill, type PhoneHeaderDiff, type PhoneHeaderThread } from './phone-header.js';

function thread(patch: Partial<PhoneHeaderThread> = {}): PhoneHeaderThread {
  return {
    branchName: 'thread/avispa',
    repoPath: '/repo',
    prUrl: null,
    prState: null,
    ...patch,
  };
}

const clean: PhoneHeaderDiff = {
  dirty: false,
  unpushed: 0,
  scopeStats: { uncommitted: { additions: 0, deletions: 0 } },
};

describe('phoneHeaderFrom', () => {
  it('hides global chats and placeholder branches', () => {
    expect(phoneHeaderFrom(thread({ repoPath: '__global__' }), clean).visible).toBe(false);
    expect(phoneHeaderFrom(thread({ branchName: '  ' }), clean).visible).toBe(false);
  });

  it('shows the branch and uncommitted counts before a diff lands', () => {
    const header = phoneHeaderFrom(thread(), null);
    expect(header).toMatchObject({
      visible: true,
      branch: 'avispa',
      ready: false,
      dirty: false,
      additions: 0,
    });
    expect(header.action).toBeUndefined();
    expect(header.title).toContain('Loading git status');
  });

  it('counts uncommitted lines and unpushed commits', () => {
    const header = phoneHeaderFrom(thread({ prUrl: 'https://github.com/acme/app/pull/12', prState: 'OPEN' }), {
      dirty: true,
      unpushed: 2,
      scopeStats: { uncommitted: { additions: 4, deletions: 1 } },
    });
    expect(header).toMatchObject({
      branch: 'avispa',
      dirty: true,
      additions: 4,
      deletions: 1,
      unpushed: 2,
      prNumber: '12',
      action: 'commit-push',
      actionLabel: 'Commit & push',
    });
  });

  it('asks for a draft PR when the branch has none', () => {
    expect(phoneHeaderFrom(thread(), clean)).toMatchObject({
      action: 'create-draft',
      actionLabel: 'Create PR',
      dirty: false,
    });
  });

  it('offers ready for review once a draft is in sync', () => {
    expect(
      phoneHeaderFrom(
        thread({ prUrl: 'https://github.com/acme/app/pull/3', prState: 'OPEN', prIsDraft: true }),
        clean,
      ),
    ).toMatchObject({ prStatus: 'Draft', action: 'ready-for-review', actionLabel: 'Ready for review' });
  });

  it('hides the action after merge and keeps the pill', () => {
    const header = phoneHeaderFrom(
      thread({ prUrl: 'https://github.com/acme/app/pull/9', prState: 'MERGED' }),
      clean,
    );
    expect(header.prStatus).toBe('Merged');
    expect(header.action).toBeUndefined();
    expect(phonePrPill(thread({ prUrl: 'https://github.com/acme/app/pull/9', prState: 'MERGED' }))).toEqual({
      url: 'https://github.com/acme/app/pull/9',
      number: '9',
      status: 'Merged',
    });
  });

  it('updates a branch that is behind its base', () => {
    expect(
      phoneHeaderFrom(
        thread({
          prUrl: 'https://github.com/acme/app/pull/4',
          prState: 'OPEN',
          prMergeStateStatus: 'BEHIND',
        }),
        clean,
      ),
    ).toMatchObject({ prStatus: 'Behind base', action: 'resolve-conflicts', actionLabel: 'Update' });
  });

  it('labels a clean cowboy checkout as push', () => {
    expect(phoneHeaderFrom(thread({ cowboy: true }), clean)).toMatchObject({
      action: 'commit-push',
      actionLabel: 'Push',
    });
  });
});
