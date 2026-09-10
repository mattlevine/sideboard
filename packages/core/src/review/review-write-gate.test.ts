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

  it('leaves ticket and branch implementation threads ungated', () => {
    expect(isReviewWriteGatedThread({ sourceType: 'ticket', title: 'ENG-9 login' })).toBe(
      false,
    );
    expect(isReviewWriteGatedThread({ sourceType: 'branch', title: 'Feat dark mode' })).toBe(
      false,
    );
  });
});

describe('formatReviewWriteGateDirective', () => {
  it('requires ask_user before public review writes', () => {
    const text = formatReviewWriteGateDirective();
    expect(text).toMatch(/PR author/);
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
  });
});
