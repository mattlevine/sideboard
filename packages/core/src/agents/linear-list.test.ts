import { afterEach, describe, expect, it, vi } from 'vitest';

const listLinearIssuesDirect = vi.hoisted(() => vi.fn());

vi.mock('../integrations/linear.js', () => ({
  listLinearIssuesDirect,
}));

import { listAssignedLinearIssues } from './linear-list.js';

describe('listAssignedLinearIssues', () => {
  afterEach(() => {
    listLinearIssuesDirect.mockReset();
  });

  it('swallows a rejection that arrives after the timeout wins', async () => {
    let rejectList: ((err: Error) => void) | undefined;
    listLinearIssuesDirect.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectList = reject;
        }),
    );
    const rejections: unknown[] = [];
    const onRejection = (err: unknown) => {
      rejections.push(err);
    };
    process.on('unhandledRejection', onRejection);
    try {
      await expect(listAssignedLinearIssues({ timeoutMs: 5 })).resolves.toEqual([]);
      rejectList?.(new Error('late linear failure'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});
