import { describe, expect, it } from 'vitest';
import {
  REVIEW_REQUEST_TEMPLATE,
  shouldRefreshReviewRequestTemplate,
} from './review-request';

describe('shouldRefreshReviewRequestTemplate', () => {
  it('refreshes the legacy findings-only stock template', () => {
    const legacy = `# Review guidelines:

You are acting as a reviewer for a proposed code change made by another engineer.

HOW MANY FINDINGS TO RETURN:

Output all findings.
`;
    expect(shouldRefreshReviewRequestTemplate(legacy)).toBe(true);
  });

  it('keeps the current readiness-focused template', () => {
    expect(shouldRefreshReviewRequestTemplate(REVIEW_REQUEST_TEMPLATE)).toBe(false);
  });

  it('keeps user customizations that already ask for a recommendation', () => {
    const custom = `# My review

Always end with ## Recommendation and say if it is ready to merge.
`;
    expect(shouldRefreshReviewRequestTemplate(custom)).toBe(false);
  });
});
