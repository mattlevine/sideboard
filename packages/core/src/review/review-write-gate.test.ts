import { describe, expect, it } from 'vitest';
import {
  formatReviewWriteGateDirective,
  formatReviewWriteGateReminder,
  isReviewWriteGatedThread,
} from './review-write-gate.js';

describe('isReviewWriteGatedThread', () => {
  it('gates Review tabs and PR-source worktrees', () => {
    expect(isReviewWriteGatedThread({ sourceType: 'pr', title: 'Fix login' })).toBe(true);
    expect(isReviewWriteGatedThread({ sourceType: 'branch', title: 'Review' })).toBe(true);
    expect(isReviewWriteGatedThread({ sourceType: 'ticket', title: 'Review' })).toBe(true);
  });

  it('gates a ticket or branch tab while a Review sibling is open', () => {
    const siblings = [
      { id: 'rev', title: 'Review', status: 'idle' as const },
      { id: 'impl', title: 'ENG-9 login', status: 'idle' as const },
    ];
    expect(
      isReviewWriteGatedThread(
        { id: 'impl', sourceType: 'ticket', title: 'ENG-9 login', worktreePath: '/wt' },
        siblings,
      ),
    ).toBe(true);
    expect(
      isReviewWriteGatedThread(
        { id: 'impl', sourceType: 'branch', title: 'Feat dark mode', worktreePath: '/wt' },
        siblings,
      ),
    ).toBe(true);
  });

  it('leaves ticket and branch implementation threads ungated without a Review tab', () => {
    expect(isReviewWriteGatedThread({ sourceType: 'ticket', title: 'ENG-9 login' })).toBe(
      false,
    );
    expect(isReviewWriteGatedThread({ sourceType: 'branch', title: 'Feat dark mode' })).toBe(
      false,
    );
    expect(
      isReviewWriteGatedThread(
        { id: 'impl', sourceType: 'ticket', title: 'ENG-9 login', worktreePath: '/wt' },
        [{ id: 'other', title: 'Notes', status: 'idle' }],
      ),
    ).toBe(false);
  });
});

describe('formatReviewWriteGateDirective', () => {
  it('requires ask_user before public review writes', () => {
    const text = formatReviewWriteGateDirective();
    expect(text).toMatch(/PR or ticket author/);
    expect(text).toMatch(/work through the feedback/);
    expect(text).toMatch(/ask_user/);
    expect(text).toMatch(/Post this review/);
    expect(text).toMatch(/Keep it in chat/);
    expect(text).toMatch(/github_comment/);
    expect(text).toMatch(/gh pr review/);
    expect(text).toMatch(/already asked you to post/);
  });
});

describe('formatReviewWriteGateReminder', () => {
  it('is a short resume line', () => {
    const text = formatReviewWriteGateReminder();
    expect(text.length).toBeLessThan(280);
    expect(text).toMatch(/ask_user/);
    expect(text).toMatch(/Post this review/);
    expect(text).toMatch(/PR or ticket/);
  });
});
