import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrchestratorEvent } from '../types/thread.js';
import { phoneBoardKey, startPhoneBoardSync } from './phone-board-sync.js';
import type { PhoneChatSummary, PhoneSidebar } from './phone-chats.js';

function chat(patch: Partial<PhoneChatSummary> = {}): PhoneChatSummary {
  return {
    id: 'chat-1',
    title: 'Agent',
    status: 'idle',
    preview: '',
    updatedAt: 't0',
    agent: 'claude',
    ...patch,
  };
}

function board(patch: Partial<PhoneSidebar> = {}): PhoneSidebar {
  return { orchestration: [], projects: [], ...patch };
}

describe('phone board sync', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('changes when the account agent defaults change', () => {
    const base = board();
    const changed = board({
      defaults: {
        followUp: 'steer',
        orchestration: { agent: 'cursor', model: null, effort: 'high', fast: false, autonomy: 'full' },
        worktree: { agent: 'codex', model: 'gpt-5', effort: 'low', fast: false, autonomy: 'full' },
      },
    });
    expect(phoneBoardKey(changed)).not.toBe(phoneBoardKey(base));
    expect(phoneBoardKey(changed)).toBe(phoneBoardKey(changed));
    const queued = board({
      defaults: { ...changed.defaults!, followUp: 'queue' },
    });
    expect(phoneBoardKey(queued)).not.toBe(phoneBoardKey(changed));
  });

  it('changes when a workspace source ticket becomes blocked', () => {
    const tree = { label: 'matt/feature', chats: [chat()] };
    const project = { name: 'sideboard', path: '/tmp/sideboard', worktrees: [tree] };
    const blocked = {
      ...project,
      worktrees: [{ ...tree, blockedBy: ['ENG-88'] }],
    };
    expect(phoneBoardKey(board({ projects: [blocked] }))).not.toBe(
      phoneBoardKey(board({ projects: [project] })),
    );
  });

  it('changes when only workspace tags change', () => {
    const tree = { label: 'matt/feature', chats: [chat()] };
    const project = { name: 'sideboard', path: '/tmp/sideboard', worktrees: [tree] };
    const tagged = {
      ...project,
      worktrees: [{ ...tree, tags: ['phone'] }],
    };
    expect(phoneBoardKey(board({ projects: [tagged] }))).not.toBe(
      phoneBoardKey(board({ projects: [project] })),
    );
  });

  it('changes when a review or pending label appears', () => {
    const tree = { label: 'matt/feature', chats: [chat()] };
    const project = { name: 'sideboard', path: '/tmp/sideboard', worktrees: [tree] };
    const pending = {
      ...project,
      worktrees: [{ ...tree, badge: { id: 'pending' as const, label: 'pending', title: 'Waiting for review' } }],
    };
    expect(phoneBoardKey(board({ projects: [pending] }))).not.toBe(
      phoneBoardKey(board({ projects: [project] })),
    );
  });

  it('changes when a Needs you ask appears or clears', () => {
    const idle = chat();
    const asking = chat({ needsYou: true, blockedReason: 'Asked the user: Which API?' });
    expect(phoneBoardKey(board({ orchestration: [asking] }))).not.toBe(
      phoneBoardKey(board({ orchestration: [idle] })),
    );
    expect(
      phoneBoardKey(board({ orchestration: [chat({ needsYou: true, blockedReason: 'Done?' })] })),
    ).not.toBe(phoneBoardKey(board({ orchestration: [asking] })));
  });

  it('changes when the choices change but the reason text does not', () => {
    const reason = 'Asked the user: Which API?';
    const rest = chat({
      needsYou: true,
      blockedReason: reason,
      ask: {
        questions: [{ question: 'Which API?', options: [{ label: 'REST' }, { label: 'GraphQL' }] }],
      },
    });
    const trpc = chat({
      needsYou: true,
      blockedReason: reason,
      ask: {
        questions: [{ question: 'Which API?', options: [{ label: 'REST' }, { label: 'tRPC' }] }],
      },
    });
    expect(phoneBoardKey(board({ orchestration: [rest] }))).not.toBe(
      phoneBoardKey(board({ orchestration: [trpc] })),
    );
    const allowed = chat({
      needsYou: true,
      blockedReason: 'Allow the edit?',
      permission: {
        id: 'p1',
        title: 'Allow the edit?',
        detail: '',
        allowSession: true,
      },
    });
    const denied = chat({
      needsYou: true,
      blockedReason: 'Allow the edit?',
      permission: {
        id: 'p2',
        title: 'Allow the edit?',
        detail: '',
        allowSession: false,
      },
    });
    expect(phoneBoardKey(board({ orchestration: [allowed] }))).not.toBe(
      phoneBoardKey(board({ orchestration: [denied] })),
    );
  });

  it('ignores bookkeeping timestamps when the list itself is unchanged', () => {
    const first = board({ orchestration: [chat({ updatedAt: 't0' })] });
    const second = board({ orchestration: [chat({ updatedAt: 't1' })] });
    expect(phoneBoardKey(first)).toBe(phoneBoardKey(second));
    expect(phoneBoardKey(board({ orchestration: [chat({ title: 'Renamed' })] }))).not.toBe(
      phoneBoardKey(first),
    );
    expect(phoneBoardKey(board({ orchestration: [chat({ agent: 'acp', acpHarness: 'copilot' })] }))).not.toBe(
      phoneBoardKey(board({ orchestration: [chat({ agent: 'acp', acpHarness: 'gemini' })] })),
    );
  });

  it('pushes the sidebar immediately and again when a worktree appears', () => {
    vi.useFakeTimers();
    let notify = () => {};
    const sent: PhoneSidebar[] = [];
    let sidebar = board();
    const stop = startPhoneBoardSync({
      debounceMs: 200,
      list: () => sidebar,
      subscribe: (fn) => {
        notify = fn;
        return () => {
          notify = () => {};
        };
      },
      events: () => () => {},
      onSidebar: (next) => sent.push(next),
    });

    expect(sent).toEqual([board()]);

    sidebar = board({
      projects: [
        {
          name: 'sideboard',
          path: '/tmp/sideboard',
          worktrees: [{ label: 'matt/feature', chats: [chat({ id: 'wt-1', title: 'Feature' })] }],
        },
      ],
    });
    notify();
    vi.advanceTimersByTime(199);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.projects[0]?.worktrees[0]?.label).toBe('matt/feature');

    notify();
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(2);

    sidebar = board({
      projects: [
        {
          name: 'sideboard',
          path: '/tmp/sideboard',
          worktrees: [
            {
              label: 'matt/feature',
              chats: [chat({ id: 'wt-1', title: 'Feature', updatedAt: 't9' })],
            },
          ],
        },
      ],
    });
    notify();
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(2);

    stop();
    sidebar = board({ orchestration: [chat({ id: 'new', title: 'After stop' })] });
    notify();
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(2);
  });

  it('follows a desktop turn only for the chat the phone has open', () => {
    vi.useFakeTimers();
    let listener: (event: OrchestratorEvent) => void = () => {};
    const running: string[] = [];
    const sent: string[] = [];
    let sidebar = board({ orchestration: [chat()] });
    const stop = startPhoneBoardSync({
      debounceMs: 200,
      list: () => sidebar,
      openChatId: () => 'chat-1',
      subscribe: () => () => {},
      events: (fn) => {
        listener = fn;
        return () => {
          listener = () => {};
        };
      },
      onSidebar: () => sent.push('sidebar'),
      onRunningChat: (chatId) => running.push(chatId),
    });
    expect(sent).toEqual(['sidebar']);

    listener({ type: 'turn_started', threadId: 'other', prompt: 'nope' });
    listener({ type: 'status_changed', threadId: 'chat-1', status: 'running' });
    expect(running).toEqual(['chat-1']);

    sidebar = board({ orchestration: [chat({ status: 'running' })] });
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(2);

    listener({ type: 'turn_output', threadId: 'chat-1', event: { type: 'stdout', data: 'hi' } });
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(2);

    stop();
  });

  it('changes when a review-requested pull request arrives or the poll fails', () => {
    const base = board();
    const ready = board({ reviewsReady: true, reviews: [] });
    const withPr = board({
      reviewsReady: true,
      reviews: [
        {
          repoPath: '/tmp/sideboard',
          repoName: 'sideboard',
          number: 12,
          title: 'Fix login',
          url: 'https://github.com/acme/app/pull/12',
        },
      ],
    });
    const opened = board({
      reviewsReady: true,
      reviews: [{ ...withPr.reviews![0]!, chatId: 'chat-9' }],
    });
    const failed = board({
      reviewsReady: true,
      reviews: [],
      reviewsError: "Couldn't load pull requests waiting on your review.",
    });
    expect(phoneBoardKey(ready)).not.toBe(phoneBoardKey(base));
    expect(phoneBoardKey(withPr)).not.toBe(phoneBoardKey(ready));
    expect(phoneBoardKey(opened)).not.toBe(phoneBoardKey(withPr));
    expect(phoneBoardKey(failed)).not.toBe(phoneBoardKey(ready));
    expect(phoneBoardKey(withPr)).toBe(phoneBoardKey(withPr));
  });

  it('pushes again after review-requested pull requests are polled', async () => {
    vi.useFakeTimers();
    let polled = false;
    const sent: PhoneSidebar[] = [];
    const empty = board();
    const withPr = board({
      reviewsReady: true,
      reviews: [
        {
          repoPath: '/tmp/sideboard',
          repoName: 'sideboard',
          number: 3,
          title: 'Please review',
          url: 'https://github.com/acme/app/pull/3',
        },
      ],
    });
    const stop = startPhoneBoardSync({
      debounceMs: 200,
      list: () => (polled ? withPr : empty),
      subscribe: () => () => {},
      events: () => () => {},
      refreshReviewPrs: async () => {
        polled = true;
      },
      onSidebar: (next) => sent.push(next),
    });
    expect(sent).toEqual([empty]);
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual([empty, withPr]);
    stop();
  });

  it('pushes again after the GitHub login arrives', async () => {
    vi.useFakeTimers();
    let loginReady = false;
    const sent: PhoneSidebar[] = [];
    const plain = board();
    const badged = board({
      projects: [
        {
          name: 'sideboard',
          path: '/tmp/sideboard',
          worktrees: [
            {
              label: 'mine',
              chats: [chat()],
              badge: { id: 'pending', label: 'pending', title: 'Waiting for review' },
            },
          ],
        },
      ],
    });
    const stop = startPhoneBoardSync({
      debounceMs: 200,
      list: () => (loginReady ? badged : plain),
      subscribe: () => () => {},
      events: () => () => {},
      refreshViewerLogin: async () => {
        loginReady = true;
      },
      onSidebar: (next) => sent.push(next),
    });

    expect(sent).toEqual([plain]);
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual([plain, badged]);
    stop();
  });
});
