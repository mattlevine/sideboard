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
      { cachedPrefix: 'should not appear', prompt: 'follow up' },
    );
    expect(cmd.args).toContain('--session');
    expect(cmd.args).toContain('ses_abc');
    expect(cmd.args).not.toContain('--continue');
    expect(cmd.stdin).toBe('follow up');
    expect(cmd.stdin).not.toContain('should not appear');
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
  it('extracts usage from step_finish even when sessionID is present', () => {
    const event = opencodeAdapter.parseEvent(
      JSON.stringify({
        type: 'step_finish',
        sessionID: 'ses_keep',
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
      scope: 'request',
    });
  });

  it('returns null for step_finish with no usable tokens', () => {
    const event = opencodeAdapter.parseEvent(
      JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'tool-calls' } }),
    );
    expect(event).toBeNull();
  });

  it('extracts session id from step_start / bare markers only', () => {
    expect(opencodeAdapter.parseEvent(JSON.stringify({ sessionID: 'ses_123' }))).toEqual({
      type: 'session_id',
      data: 'ses_123',
    });
    expect(
      opencodeAdapter.parseEvent(
        JSON.stringify({ type: 'step_start', sessionID: 'ses_123', part: { type: 'step-start' } }),
      ),
    ).toEqual({ type: 'session_id', data: 'ses_123' });
  });

  it('does not steal --session from nested task step_start', () => {
    expect(
      opencodeAdapter.parseEvent(
        JSON.stringify({
          type: 'step_start',
          sessionID: 'ses_child',
          childSessionID: 'ses_child',
          part: { type: 'step-start' },
        }),
      ),
    ).toBeNull();
  });

  it('does not let sessionID short-circuit text or tools', () => {
    expect(
      opencodeAdapter.parseEvent(
        JSON.stringify({
          type: 'text',
          sessionID: 'ses_keep',
          part: { type: 'text', text: 'hello' },
        }),
      ),
    ).toEqual({ type: 'stdout', data: 'hello' });

    const html = '<!DOCTYPE html><html><body><h1>Doc</h1></body></html>';
    const payload = JSON.stringify({
      ok: true,
      artifact_id: 'a1',
      title: 'Doc',
      type: 'html',
      content: html,
    });
    expect(
      opencodeAdapter.parseEvent(
        JSON.stringify({
          type: 'tool_use',
          sessionID: 'ses_keep',
          part: {
            id: 'prt_1',
            callID: 'call_1',
            tool: 'present_artifact',
            type: 'tool',
            state: {
              status: 'completed',
              input: { title: 'Doc', type: 'html', content: html, artifact_id: 'a1' },
              output: payload,
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'present_artifact',
        input: { title: 'Doc', type: 'html', content: html, artifact_id: 'a1' },
      },
      {
        type: 'tool_result',
        id: 'call_1',
        content: payload,
        isError: false,
      },
    ]);
  });

  it('tails bash output while the tool is still running', () => {
    expect(
      opencodeAdapter.parseEvent(
        JSON.stringify({
          type: 'tool_use',
          sessionID: 'ses_keep',
          part: {
            id: 'prt_bash',
            callID: 'bash_live',
            tool: 'bash',
            type: 'tool',
            state: {
              status: 'running',
              input: { command: 'pnpm build' },
              output: 'vite v6 building…\n',
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: 'tool_use',
        id: 'bash_live',
        name: 'bash',
        input: { command: 'pnpm build' },
      },
      {
        type: 'tool_result',
        id: 'bash_live',
        content: 'vite v6 building…\n',
        isError: false,
        partial: true,
      },
    ]);
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

  it('keys task tools by child session id and maps subtask streams', () => {
    expect(
      opencodeAdapter.parseEvent(
        JSON.stringify({
          type: 'tool_use',
          sessionID: 'ses_parent',
          part: {
            callID: 'call_task',
            tool: 'task',
            state: {
              status: 'completed',
              input: { description: 'Explore auth', prompt: 'Find login' },
              output: 'done',
              metadata: { sessionId: 'ses_child' },
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: 'tool_use',
        id: 'ses_child',
        name: 'task',
        input: { description: 'Explore auth', prompt: 'Find login' },
      },
      { type: 'tool_result', id: 'ses_child', content: 'done', isError: false },
    ]);

    expect(
      opencodeAdapter.parseEvent(
        JSON.stringify({
          type: 'subtask_delta',
          childSessionID: 'ses_child',
          delta: 'scan login',
        }),
      ),
    ).toEqual([
      { type: 'tool_use', id: 'ses_child', name: 'task' },
      { type: 'thinking', data: 'scan login', parentId: 'ses_child' },
    ]);

    expect(
      opencodeAdapter.parseEvent(
        JSON.stringify({
          type: 'subtask_event',
          childSessionID: 'ses_child',
          part: {
            type: 'tool',
            callID: 'bash1',
            tool: 'bash',
            state: {
              status: 'completed',
              input: { command: 'ls' },
              output: 'ok',
            },
          },
        }),
      ),
    ).toEqual([
      { type: 'tool_use', id: 'ses_child', name: 'task' },
      {
        type: 'tool_use',
        id: 'bash1',
        name: 'bash',
        input: { command: 'ls' },
        parentId: 'ses_child',
      },
      {
        type: 'tool_result',
        id: 'bash1',
        content: 'ok',
        isError: false,
        parentId: 'ses_child',
      },
    ]);
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
