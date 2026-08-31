import { describe, expect, it } from 'vitest';
import type { Thread, ThreadMessage } from '../types/thread.js';
import {
  applyCompaction,
  applyForwardOccupancy,
  buildBrightsySessionSeed,
  buildSessionSeed,
  estimateOccupancyTokens,
  estimateThreadChars,
  extractBrightsyContextSummary,
  findLastBrightsyContextSummary,
  forwardContextUsage,
  forwardOccupancyTokens,
  lastRequestOccupancy,
  maybeCompactContext,
  messagesSinceLastBrightsyContextSummary,
  shouldCompactContext,
  shouldResetSessionForOccupancy,
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

  it('extractBrightsyContextSummary reads context_summary and skips failures', () => {
    expect(
      extractBrightsyContextSummary(
        JSON.stringify({ context_summary: 'User asked about billing.' }),
      ),
    ).toBe('User asked about billing.');
    expect(extractBrightsyContextSummary(JSON.stringify({ error: 'nope' }))).toBeNull();
    expect(
      extractBrightsyContextSummary('Context summarization failed: timeout'),
    ).toBeNull();
  });

  it('messagesSinceLastBrightsyContextSummary starts after the last successful tool', () => {
    const messages = [
      msg('user', 'old goal'),
      msg('agent', 'old work'),
      msg('agent', 'compressed', {
        parts: [
          {
            type: 'tool',
            id: 'c1',
            name: 'summarize_context',
            status: 'done',
            result: JSON.stringify({ context_summary: 'Auth shipped' }),
          },
        ],
      }),
      msg('user', 'now tests'),
      msg('agent', 'added specs'),
      msg('agent', 'compressed again', {
        parts: [
          {
            type: 'tool',
            id: 'c2',
            name: 'summarize_context',
            status: 'done',
            result: JSON.stringify({ context_summary: 'Tests next' }),
          },
        ],
      }),
      msg('user', 'run them'),
      msg('agent', 'green'),
    ];
    const window = messagesSinceLastBrightsyContextSummary(messages);
    expect(window.map((m) => m.text)).toEqual(['run them', 'green']);
    expect(findLastBrightsyContextSummary(messages)?.text).toBe('Tests next');
  });

  it('messagesSinceLastBrightsyContextSummary ignores Sideboard role:summary and failed tools', () => {
    const messages = [
      msg('summary', '- Sideboard compact — not Brightsy'),
      msg('user', 'keep me when no tool'),
      msg('agent', 'failed compress', {
        parts: [
          {
            type: 'tool',
            id: 'c0',
            name: 'summarize_context',
            status: 'done',
            result: JSON.stringify({ error: 'failed again' }),
          },
        ],
      }),
    ];
    expect(messagesSinceLastBrightsyContextSummary(messages)).toEqual(messages);
  });

  it('messagesSinceLastBrightsyContextSummary returns the full thread when never summarized', () => {
    const messages = fatThread(20, 20);
    expect(messagesSinceLastBrightsyContextSummary(messages)).toEqual(messages);
  });

  it('buildBrightsySessionSeed includes every turn after summarize_context, not a last-N cap', () => {
    const afterSummary = Array.from({ length: 10 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'agent', `turn-${i}`),
    );
    const messages = [
      msg('user', 'ancient'),
      msg('agent', 'dropped after summarize_context', {
        parts: [
          {
            type: 'tool',
            id: 'c1',
            name: 'summarize_context',
            status: 'done',
            result: JSON.stringify({ context_summary: 'Prior work on auth' }),
          },
        ],
      }),
      ...afterSummary,
    ];
    const seed = buildBrightsySessionSeed(messages);
    expect(seed).toContain('Prior work on auth');
    expect(seed).toContain('turn-0');
    expect(seed).toContain('turn-9');
    expect(seed).not.toContain('ancient');
    expect(seed).not.toContain('dropped after summarize_context');
    expect(seed).not.toContain('#### Tool:');
  });

  it('buildBrightsySessionSeed omits non-summary tool bodies', () => {
    const seed = buildBrightsySessionSeed([
      msg('user', 'edit the file'),
      msg('agent', 'Done', {
        parts: [
          {
            type: 'tool',
            id: 't1',
            name: 'Edit',
            status: 'done',
            description: 'Edit auth.ts',
            input: { file_path: 'src/auth.ts' },
            result: 'ok',
            filePath: 'src/auth.ts',
          },
        ],
      }),
    ]);
    expect(seed).toContain('edit the file');
    expect(seed).toContain('Done');
    expect(seed).not.toContain('#### Tool:');
    expect(seed).not.toContain('src/auth.ts');
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

  it('maybeCompactContext keeps the CLI session when occupancy is below the window', async () => {
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
      prState: null,
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
    expect(result.thread.sessionId).toBe('sess-123');
    expect(result.thread.messages[0]?.role).toBe('summary');
    expect(result.thread.messages[0]?.text).toContain('Compacted goals');
    expect(result.method).toBe('extractive');
  });

  it('maybeCompactContext clears session when last-request occupancy is near the window', async () => {
    const messages = fatThread(20, 6_000);
    messages[messages.length - 1] = {
      ...messages[messages.length - 1]!,
      role: 'agent',
      usage: { inputTokens: 200_000, outputTokens: 1_000, lastRequestTokens: 800_000 },
    };
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
      prState: null,
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
      async () => ({ summary: '- Near window', method: 'extractive' }),
    );

    expect(result.didCompact).toBe(true);
    expect(result.thread.sessionId).toBeNull();
    const lastAgent = [...result.thread.messages].reverse().find((m) => m.role === 'agent');
    expect(lastAgent?.usage?.lastRequestTokens).toBe(
      estimateOccupancyTokens(result.thread.messages),
    );
    expect(lastAgent?.usage?.lastRequestTokens).toBeLessThan(800_000);
  });

  it('occupancy helpers read lastRequestTokens from the latest usage', () => {
    expect(lastRequestOccupancy({ messages: [] })).toBe(0);
    const messages = fatThread(4, 10);
    messages[3] = {
      ...messages[3]!,
      role: 'agent',
      usage: { inputTokens: 10, outputTokens: 2, lastRequestTokens: 12_000 },
    };
    expect(lastRequestOccupancy({ messages })).toBe(12_000);
    expect(shouldResetSessionForOccupancy({ messages }, 10_000)).toBe(true);
    expect(shouldResetSessionForOccupancy({ messages }, 20_000)).toBe(false);
  });

  it('forwardContextUsage caps the meter to remaining transcript after compression', () => {
    const recent = fatThread(4, 200);
    const messages = [
      msg('summary', '- Prior work summarized'),
      ...recent.slice(0, 3),
      {
        ...recent[3]!,
        role: 'agent' as const,
        usage: { inputTokens: 50_000, outputTokens: 20, lastRequestTokens: 820_000 },
      },
    ];
    const forward = forwardContextUsage(messages[messages.length - 1]!.usage!, messages);
    expect(forward?.lastRequestTokens).toBe(estimateOccupancyTokens(messages));
    expect(forward!.lastRequestTokens!).toBeLessThan(820_000);
  });

  it('forwardOccupancyTokens uses remaining transcript after compression, not billed peak', () => {
    const recent = fatThread(4, 200);
    const messages = [
      msg('summary', '- Prior work summarized'),
      ...recent.slice(0, 3),
      {
        ...recent[3]!,
        role: 'agent' as const,
        usage: { inputTokens: 50_000, outputTokens: 20, lastRequestTokens: 820_000 },
      },
    ];
    const forward = forwardOccupancyTokens(messages, messages[messages.length - 1]!.usage);
    expect(forward).toBe(estimateOccupancyTokens(messages));
    expect(forward).toBeLessThan(820_000);
  });

  it('forwardOccupancyTokens ignores last-request billed leaks over the window', () => {
    const messages = [msg('user', 'hello'), msg('agent', 'ok')];
    const leak = {
      inputTokens: 800_000,
      outputTokens: 50_000,
      cacheReadTokens: 1_600_000,
      lastRequestTokens: 2_500_000,
    };
    const forward = forwardOccupancyTokens(messages, leak, 1_000_000);
    expect(forward).toBe(estimateOccupancyTokens(messages));
    expect(forward).toBeLessThan(10_000);
  });

  it('applyForwardOccupancy writes going-forward occupancy onto the last agent turn', () => {
    const messages = [
      msg('summary', '- Compacted'),
      msg('user', 'continue'),
      msg('agent', 'ok', {
        usage: { inputTokens: 10, outputTokens: 2, lastRequestTokens: 900_000 },
      }),
    ];
    const next = applyForwardOccupancy(messages);
    expect(next[2]?.usage?.lastRequestTokens).toBe(estimateOccupancyTokens(next));
    expect(next[2]?.usage?.lastRequestTokens).toBeLessThan(900_000);
  });
});
