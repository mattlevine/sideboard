import { describe, expect, it } from 'vitest';
import { CODEX_PROMPT_ARG_MAX, codexAdapter } from './codex.js';

const baseThread = {
  id: 't1',
  agent: 'codex' as const,
  worktreePath: '/tmp/wt',
  repoPath: '/tmp/repo',
  sessionId: null as string | null,
  autonomy: 'default' as const,
  model: null,
  effort: 'high',
    fast: false,
  planMode: false,
  messages: [],
  attachments: [],
  status: 'idle' as const,
  branch: 'main',
  createdAt: '',
  updatedAt: '',
  ref: 't1',
};

describe('codexAdapter.buildTurn', () => {
  it('uses read-only sandbox in plan mode', async () => {
    const cmd = await codexAdapter.buildTurn(
      { ...baseThread, planMode: true },
      { prompt: 'plan migration' },
    );
    expect(cmd.args).toContain('--sandbox');
    expect(cmd.args[cmd.args.indexOf('--sandbox') + 1]).toBe('read-only');
  });

  it('passes flattened plain-text prompt as positional arg (no cache markers)', async () => {
    const cmd = await codexAdapter.buildTurn(baseThread, {
      cachedPrefix: 'AGENTS.md body',
      prompt: 'fix the bug',
    });
    expect(cmd.args[0]).toBe('exec');
    expect(cmd.args[1]).toContain('AGENTS.md body');
    expect(cmd.args[1]).toContain('fix the bug');
    expect(cmd.args).not.toContain('-');
    expect(cmd.stdin).toBeUndefined();
    expect(cmd.args).toContain('--json');
  });

  it('uses resume with explicit session id (never --last)', async () => {
    const cmd = await codexAdapter.buildTurn(
      { ...baseThread, sessionId: 'thread-abc' },
      { cachedPrefix: 'stable prefix', prompt: 'next step' },
    );
    expect(cmd.args.slice(0, 4)).toEqual(['exec', 'resume', 'thread-abc', expect.any(String)]);
    expect(cmd.args).not.toContain('--last');
  });

  it('uses stdin sentinel for oversized prompts', async () => {
    const big = 'x'.repeat(CODEX_PROMPT_ARG_MAX + 1);
    const cmd = await codexAdapter.buildTurn(baseThread, { prompt: big });
    expect(cmd.args[1]).toBe('-');
    expect(cmd.stdin).toBe(`${big}\n`);
  });
});

describe('codexAdapter.parseEvent', () => {
  it('extracts usage from turn.completed', () => {
    const event = codexAdapter.parseEvent(
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 24763,
          cached_input_tokens: 20000,
          output_tokens: 122,
          reasoning_output_tokens: 40,
        },
      }),
    );
    expect(event).toEqual({
      type: 'usage',
      data: { inputTokens: 24763, outputTokens: 162, cacheReadTokens: 20000 },
    });
  });

  it('extracts agent_message text from item.completed', () => {
    const event = codexAdapter.parseEvent(
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_1', type: 'agent_message', text: 'hello' },
      }),
    );
    expect(event).toEqual({ type: 'stdout', data: 'hello' });
  });

  it('extracts session_id from thread.started', () => {
    const event = codexAdapter.parseEvent(
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' }),
    );
    expect(event).toEqual({ type: 'session_id', data: 'thread-123' });
  });

  it('maps turn.failed to stderr with nested error message', () => {
    const event = codexAdapter.parseEvent(
      JSON.stringify({
        type: 'turn.failed',
        error: { message: 'Invalid User API Key' },
      }),
    );
    expect(event).toEqual({ type: 'stderr', data: 'Invalid User API Key' });
  });

  it('maps type=error to stderr and ignores Reconnecting notices', () => {
    expect(
      codexAdapter.parseEvent(
        JSON.stringify({ type: 'error', message: 'quota exceeded for org' }),
      ),
    ).toEqual({ type: 'stderr', data: 'quota exceeded for org' });
    expect(
      codexAdapter.parseEvent(JSON.stringify({ type: 'error', message: 'Reconnecting...' })),
    ).toBeNull();
  });

  it('maps failed items to stderr', () => {
    expect(
      codexAdapter.parseEvent(
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'command_execution', status: 'failed', message: 'exit 127' },
        }),
      ),
    ).toEqual({ type: 'stderr', data: 'exit 127' });
  });

  it('does not dump unknown JSON into stdout', () => {
    expect(codexAdapter.parseEvent(JSON.stringify({ type: 'mystery', foo: 1 }))).toBeNull();
  });
});
