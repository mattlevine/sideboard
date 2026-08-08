import { describe, expect, it } from 'vitest';
import { opencodeAdapter } from './opencode.js';

const baseThread = {
  id: 't1',
  agent: 'opencode' as const,
  worktreePath: '/tmp/wt',
  repoPath: '/tmp/repo',
  sessionId: null as string | null,
  autonomy: 'default' as const,
  model: null,
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

describe('opencodeAdapter.buildTurn', () => {
  it('denies edits in plan mode via OPENCODE_PERMISSION', async () => {
    const cmd = await opencodeAdapter.buildTurn(
      { ...baseThread, planMode: true },
      { prompt: 'plan feature' },
    );
    const perms = JSON.parse(cmd.env!.OPENCODE_PERMISSION!);
    expect(perms.edit).toBe('deny');
  });

  it('sends plain-text flattened prompt on stdin (no positional message, no cache_control)', async () => {
    const cmd = await opencodeAdapter.buildTurn(baseThread, {
      cachedPrefix: 'seed',
      prompt: 'do thing',
    });
    expect(cmd.args[0]).toBe('run');
    expect(cmd.stdin).toContain('seed');
    expect(cmd.stdin).toContain('do thing');
    expect(cmd.stdin).not.toContain('cache_control');
    expect(cmd.args.includes('--input-format')).toBe(false);
    expect(cmd.args[cmd.args.indexOf('--format') + 1]).toBe('json');
  });

  it('continues via --session id (never --continue)', async () => {
    const cmd = await opencodeAdapter.buildTurn(
      { ...baseThread, sessionId: 'ses_abc' },
      { prompt: 'follow up' },
    );
    expect(cmd.args).toContain('--session');
    expect(cmd.args).toContain('ses_abc');
    expect(cmd.args).not.toContain('--continue');
    expect(cmd.stdin).toBe('follow up');
  });
});

describe('opencodeAdapter.parseEvent', () => {
  it('extracts usage from step_finish', () => {
    const event = opencodeAdapter.parseEvent(
      JSON.stringify({
        type: 'step_finish',
        part: {
          type: 'step-finish',
          reason: 'stop',
          cost: 0.001,
          tokens: { input: 671, output: 8, reasoning: 0, cache: { read: 21415, write: 0 } },
        },
      }),
    );
    expect(event).toEqual({
      type: 'usage',
      data: { inputTokens: 671, outputTokens: 8, cacheReadTokens: 21415 },
    });
  });

  it('returns null for step_finish with no usable tokens', () => {
    const event = opencodeAdapter.parseEvent(
      JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'tool-calls' } }),
    );
    expect(event).toBeNull();
  });

  it('extracts session id', () => {
    const event = opencodeAdapter.parseEvent(JSON.stringify({ sessionID: 'ses_123' }));
    expect(event).toEqual({ type: 'session_id', data: 'ses_123' });
  });

  it('maps error events to stderr (including nested objects)', () => {
    expect(
      opencodeAdapter.parseEvent(
        JSON.stringify({ type: 'error', error: { message: 'Unauthorized' } }),
      ),
    ).toEqual({ type: 'stderr', data: 'Unauthorized' });
    expect(
      opencodeAdapter.parseEvent(
        JSON.stringify({
          type: 'error',
          sessionID: 'ses_keep',
          message: 'Credit balance is too low',
        }),
      ),
    ).toEqual({ type: 'stderr', data: 'Credit balance is too low' });
  });

  it('does not dump unknown JSON into stdout', () => {
    expect(opencodeAdapter.parseEvent(JSON.stringify({ type: 'mystery', foo: 1 }))).toBeNull();
  });
});
