import { describe, expect, it } from 'vitest';
import { latestVisibleMessageText } from '../board/home-board.js';
import { createEmptyThread } from './thread-store.js';
import { slimThreadForUiList } from './thread-list.js';

function threadWithMessages(
  messages: Array<{
    role: 'user' | 'agent' | 'summary';
    text: string;
    parts?: Array<{ type: 'text' | 'tool'; text?: string; id?: string; name?: string; status?: 'done' }>;
    usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
    ts?: string;
  }>,
) {
  const t = createEmptyThread({
    title: 'ajax',
    sourceType: 'branch',
    sourceRef: 'main',
    branchName: 'thread/ajax',
    worktreePath: '/tmp/ajax',
    repoPath: '/tmp/repo',
    agent: 'claude',
  });
  return {
    ...t,
    attachments: [{ id: 'a', name: 'note.md', kind: 'file' as const, content: 'huge' }],
    pendingTurnAttachments: [
      { id: 'img', name: 'shot.png', kind: 'file' as const, content: 'huge-preview' },
    ],
    messages: messages.map((m, i) => ({
      role: m.role,
      text: m.text,
      parts: m.parts as never,
      usage: m.usage,
      ts: m.ts ?? `2026-01-01T00:00:0${i}.000Z`,
    })),
  };
}

describe('slimThreadForUiList', () => {
  it('drops tool parts, older bodies, and pending attachments', () => {
    const full = threadWithMessages([
      { role: 'user', text: 'first prompt' },
      {
        role: 'agent',
        text: 'working',
        parts: [
          { type: 'text', text: 'working' },
          {
            type: 'tool',
            id: 't1',
            name: 'Read',
            status: 'done',
            text: 'x'.repeat(20_000),
          },
        ],
        usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.01 },
      },
      { role: 'user', text: 'follow up please' },
    ]);

    const slim = slimThreadForUiList(full);
    expect(slim.attachments).toEqual([]);
    expect(slim.pendingTurnAttachments).toEqual([]);
    expect(slim.messages.some((m) => m.parts)).toBe(false);
    expect(slim.messages.join('')).not.toContain('x'.repeat(50));
    expect(latestVisibleMessageText(slim.messages)).toBe('follow up please');
    expect(slim.messages.some((m) => m.role === 'agent' && m.ts === full.messages[1]!.ts)).toBe(
      true,
    );
    expect(slim.messages.reduce((n, m) => n + (m.usage?.inputTokens ?? 0), 0)).toBe(10);
  });

  it('keeps an empty list empty', () => {
    const empty = threadWithMessages([]);
    expect(slimThreadForUiList(empty).messages).toEqual([]);
  });

  it('rolls usage onto the last visible agent turn', () => {
    const full = threadWithMessages([
      {
        role: 'agent',
        text: 'done',
        usage: { inputTokens: 3, outputTokens: 1, costUsd: 0.002 },
      },
    ]);
    const slim = slimThreadForUiList(full);
    expect(slim.messages).toHaveLength(1);
    expect(slim.messages[0]?.text).toBe('done');
    expect(slim.messages[0]?.usage).toEqual({
      inputTokens: 3,
      outputTokens: 1,
      costUsd: 0.002,
    });
  });
});
