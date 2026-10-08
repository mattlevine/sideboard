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

  it('ignores bookkeeping timestamps when the list itself is unchanged', () => {
    const first = board({ orchestration: [chat({ updatedAt: 't0' })] });
    const second = board({ orchestration: [chat({ updatedAt: 't1' })] });
    expect(phoneBoardKey(first)).toBe(phoneBoardKey(second));
    expect(phoneBoardKey(board({ orchestration: [chat({ title: 'Renamed' })] }))).not.toBe(
      phoneBoardKey(first),
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
});
