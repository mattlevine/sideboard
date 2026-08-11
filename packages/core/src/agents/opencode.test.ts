import { describe, expect, it, vi, beforeEach } from 'vitest';

const runMock = vi.fn();
vi.mock('../git/run.js', () => ({
  run: (...args: unknown[]) => runMock(...args),
}));

import { opencodeAdapter } from './opencode.js';

const baseThread = {
  id: 't1',
  agent: 'opencode' as const,
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

beforeEach(() => {
  runMock.mockReset();
  runMock.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' });
});

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

  it('injects Sideboard MCP via OPENCODE_CONFIG_CONTENT', async () => {
    const cmd = await opencodeAdapter.buildTurn(baseThread, { prompt: 'list threads' });
    const content = cmd.env?.OPENCODE_CONFIG_CONTENT;
    expect(content).toBeTruthy();
    const parsed = JSON.parse(content!) as {
      mcp?: Record<string, { type?: string; command?: string[]; enabled?: boolean }>;
    };
    expect(parsed.mcp?.sideboard?.type).toBe('local');
    expect(parsed.mcp?.sideboard?.enabled).toBe(true);
    expect(parsed.mcp?.sideboard?.command?.length).toBeGreaterThan(0);
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

describe('opencodeAdapter.resolveSessionId', () => {
  it('prefers the cached session and does not auto-adopt another worktree session', async () => {
    runMock.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify([
        { id: 'ses_other', directory: '/tmp/wt' },
        { id: 'ses_mine', directory: '/tmp/wt' },
      ]),
      stderr: '',
    });

    await expect(opencodeAdapter.resolveSessionId('/tmp/wt', 'ses_mine')).resolves.toBe(
      'ses_mine',
    );
    await expect(opencodeAdapter.resolveSessionId('/tmp/wt', null)).resolves.toBeNull();
    await expect(opencodeAdapter.resolveSessionId('/tmp/wt', 'ses_gone')).resolves.toBeNull();
  });
});
