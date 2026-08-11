import { describe, expect, it } from 'vitest';
import type { Thread, ThreadMessage } from '../types/thread.js';
import {
  applyCompaction,
  buildSessionSeed,
  estimateThreadChars,
  maybeCompactContext,
  shouldCompactContext,
  splitForCompaction,
} from './context-compact.js';

function msg(
  role: ThreadMessage['role'],
  text: string,
  extra?: Partial<ThreadMessage>,
): ThreadMessage {
  return { role, text, ts: new Date().toISOString(), ...extra };
}

function fatThread(count: number, charsEach: number): ThreadMessage[] {
  const body = 'x'.repeat(charsEach);
  return Array.from({ length: count }, (_, i) =>
    msg(i % 2 === 0 ? 'user' : 'agent', `${body}-${i}`),
  );
}

describe('context compact', () => {
  it('detects oversized threads', () => {
    const small = fatThread(4, 100);
    expect(shouldCompactContext(small, { minMessages: 3, maxChars: 10_000 })).toBe(false);

    const big = fatThread(20, 6_000);
    expect(shouldCompactContext(big, { minMessages: 10, maxChars: 50_000 })).toBe(true);
  });

  it('keeps recent messages when splitting', () => {
    const messages = fatThread(20, 2_000);
    const { older, recent } = splitForCompaction(messages, {
      keepRecentChars: 8_000,
      keepRecentMessages: 6,
    });
    expect(recent.length).toBeGreaterThanOrEqual(6);
    expect(older.length + recent.length).toBe(messages.length);
    expect(recent[recent.length - 1]?.text).toBe(messages[messages.length - 1]?.text);
  });

  it('replaces older turns with a summary message', () => {
    const messages = fatThread(16, 3_000);
    const next = applyCompaction(messages, '- Goal: ship compact\n- Open: tests', {
      keepRecentChars: 10_000,
      keepRecentMessages: 6,
    });
    expect(next[0]?.role).toBe('summary');
    expect(next[0]?.text).toContain('ship compact');
    expect(next.length).toBeLessThan(messages.length);
    expect(estimateThreadChars(next)).toBeLessThan(estimateThreadChars(messages));
  });

  it('builds a session seed from messages', () => {
    const seed = buildSessionSeed([
      msg('summary', '- Prior work on auth'),
      msg('user', 'fix the login bug'),
      msg('agent', 'Patched auth.ts'),
    ]);
    expect(seed).toContain('Prior work on auth');
    expect(seed).toContain('fix the login bug');
    expect(seed).toContain('Patched auth.ts');
  });

  it('includes full tool input and result in session seed', () => {
    const seed = buildSessionSeed([
      msg('user', 'edit the file'),
      msg('agent', 'Done', {
        parts: [
          {
            type: 'tool',
            id: 't1',
            name: 'Edit',
            status: 'done',
            description: 'Edit auth.ts',
            input: { file_path: 'src/auth.ts', old_string: 'a', new_string: 'b'.repeat(120) },
            result: 'ok\n'.repeat(40),
            filePath: 'src/auth.ts',
          },
        ],
      }),
    ]);
    expect(seed).toContain('#### Tool: Edit');
    expect(seed).toContain('file_path');
    expect(seed).toContain('src/auth.ts');
    expect(seed).toContain('b'.repeat(120));
    expect(seed).toContain('ok\n'.repeat(40).trimEnd());
  });

  it('maybeCompactContext clears session and persists summary', async () => {
    const messages = fatThread(20, 6_000);
    const thread = {
      id: 't1',
      title: 'test',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'feat',
      worktreePath: '/tmp',
      repoPath: '/tmp',
      agent: 'claude',
      model: null,
      effort: 'high',
      fast: false,
      planMode: false,
      sessionId: 'sess-123',
      autonomy: 'default',
      sourceIsFork: false,
      status: 'idle',
      queue: [],
      parentThreadId: null,
      devPort: null,
      prUrl: null,
      prTitle: null,
      stackId: null,
      stackLayer: null,
      userSetTitle: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages,
      attachments: [],
    } satisfies Thread;

    const result = await maybeCompactContext(
      thread,
      { maxChars: 50_000, minMessages: 10, keepRecentMessages: 6, keepRecentChars: 12_000 },
      async () => ({ summary: '- Compacted goals', method: 'extractive' }),
    );

    expect(result.didCompact).toBe(true);
    expect(result.thread.sessionId).toBeNull();
    expect(result.thread.messages[0]?.role).toBe('summary');
    expect(result.thread.messages[0]?.text).toContain('Compacted goals');
    expect(result.method).toBe('extractive');
  });
});
