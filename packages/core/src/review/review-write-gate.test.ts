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
  it('keeps the review in chat and does not ask_user after it', () => {
    const text = formatReviewWriteGateDirective();
    expect(text).toMatch(/PR or ticket author/);
    expect(text).toMatch(/work through the feedback/);
    expect(text).toMatch(/Do not call ask_user/);
    expect(text).toMatch(/type a next step/);
    expect(text).not.toMatch(/ask_user \(Post this review/);
    expect(text).toMatch(/github_comment/);
    expect(text).toMatch(/gh pr review/);
    expect(text).toMatch(/already asked you to post/);
  });
});

describe('formatReviewWriteGateReminder', () => {
  it('is a short resume line', () => {
    const text = formatReviewWriteGateReminder();
    expect(text.length).toBeLessThan(280);
    expect(text).toMatch(/Do not ask_user after it/);
    expect(text).toMatch(/type next steps/);
    expect(text).not.toMatch(/ask_user \(Post this review/);
    expect(text).toMatch(/PR or ticket/);
  });
});
