import { describe, expect, it } from 'vitest';
import type { Thread } from '../types/thread.js';
import { agentPurposeStamp } from './agent-purpose-title.js';

function thread(
  partial: Partial<Thread> & Pick<Thread, 'title'>,
): Pick<
  Thread,
  | 'title'
  | 'userSetTitle'
  | 'worktreePath'
  | 'branchName'
  | 'prTitle'
  | 'sourceType'
  | 'messages'
> {
  return {
    userSetTitle: false,
    worktreePath: '/wt/lens',
    branchName: 'feat/replace-spinner',
    prTitle: 'feat: replace full-page spinner',
    sourceType: 'branch',
    messages: [],
    ...partial,
  };
}

describe('agentPurposeStamp', () => {
  it('names the first turn after the prompt when that is not the PR', () => {
    expect(
      agentPurposeStamp({
        thread: thread({
          title: 'Lens',
          messages: [{ role: 'user', text: 'add dark mode to settings', ts: '1' }],
        }),
        prompt: 'add dark mode to settings',
        autoContinue: false,
      }),
    ).toEqual({ title: 'Add dark mode to settings' });
  });

  it('keeps the soccer nickname when the prompt restates the PR', () => {
    expect(
      agentPurposeStamp({
        thread: thread({
          title: 'feat: replace full-page spinner',
          messages: [
            { role: 'user', text: 'feat: replace full-page spinner', ts: '1' },
          ],
        }),
        prompt: 'feat: replace full-page spinner',
        autoContinue: false,
      }),
    ).toEqual({ title: 'Lens' });
  });

  it('does not rename later turns from a follow-up prompt', () => {
    expect(
      agentPurposeStamp({
        thread: thread({
          title: 'Lens',
          messages: [
            { role: 'user', text: 'first', ts: '1' },
            { role: 'user', text: 'then add tests', ts: '2' },
          ],
        }),
        prompt: 'then add tests',
        autoContinue: false,
      }),
    ).toBeNull();
  });

  it('does not overwrite a user rename', () => {
    expect(
      agentPurposeStamp({
        thread: thread({
          title: 'Write tests',
          userSetTitle: true,
          messages: [{ role: 'user', text: 'add dark mode to settings', ts: '1' }],
        }),
        prompt: 'add dark mode to settings',
        autoContinue: false,
      }),
    ).toBeNull();
  });

  it('upgrades a soccer tab nickname from the first prompt', () => {
    expect(
      agentPurposeStamp({
        thread: thread({
          title: 'Arsenal',
          userSetTitle: true,
          messages: [{ role: 'user', text: 'add dark mode to settings', ts: '1' }],
        }),
        prompt: 'add dark mode to settings',
        autoContinue: false,
      }),
    ).toEqual({ title: 'Add dark mode to settings' });
  });
});
