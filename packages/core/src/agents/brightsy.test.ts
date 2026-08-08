import { describe, expect, it } from 'vitest';
import { brightsyAdapter } from './brightsy.js';
import { decodeBrightsyTarget, encodeBrightsyTarget } from './brightsy-targets.js';

const baseThread = {
  id: 't1',
  agent: 'brightsy' as const,
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

describe('decodeBrightsyTarget / encodeBrightsyTarget', () => {
  it('defaults null to the platform default agent', () => {
    expect(decodeBrightsyTarget(null)).toEqual({ type: 'agent', id: 'default' });
    expect(decodeBrightsyTarget(undefined)).toEqual({ type: 'agent', id: 'default' });
  });

  it('round-trips agent and model encodings', () => {
    expect(decodeBrightsyTarget(encodeBrightsyTarget('agent', 'abc'))).toEqual({
      type: 'agent',
      id: 'abc',
    });
    expect(decodeBrightsyTarget(encodeBrightsyTarget('model', 'claude_sonnet_latest'))).toEqual({
      type: 'model',
      id: 'claude_sonnet_latest',
    });
  });

  it('round-trips team-scoped encodings', () => {
    expect(
      decodeBrightsyTarget(
        encodeBrightsyTarget('agent', 'abc', 'acc-1'),
      ),
    ).toEqual({ type: 'agent', id: 'abc', accountId: 'acc-1' });
    expect(
      decodeBrightsyTarget(
        encodeBrightsyTarget('model', 'claude_sonnet_latest', 'acc-2'),
      ),
    ).toEqual({
      type: 'model',
      id: 'claude_sonnet_latest',
      accountId: 'acc-2',
    });
  });

  it('treats bare model slugs as models and UUIDs as agents', () => {
    expect(decodeBrightsyTarget('claude_sonnet_latest')).toEqual({
      type: 'model',
      id: 'claude_sonnet_latest',
    });
    expect(decodeBrightsyTarget('9eace707-acb5-457b-b2fd-4a6e9807e7ad')).toEqual({
      type: 'agent',
      id: '9eace707-acb5-457b-b2fd-4a6e9807e7ad',
    });
  });
});

describe('brightsyAdapter.buildTurn', () => {
  it('runs chat --json with the flattened prompt on stdin', async () => {
    const cmd = await brightsyAdapter.buildTurn(baseThread, {
      cachedPrefix: 'seed',
      prompt: 'do thing',
    });
    expect(cmd.file).toBe('brightsy');
    expect(cmd.args.slice(0, 2)).toEqual(['chat', '--json']);
    expect(cmd.stdin).toContain('seed');
    expect(cmd.stdin).toContain('do thing');
    expect(cmd.args[cmd.args.indexOf('--agent') + 1]).toBe('default');
  });

  it('maps planMode to --mode plan', async () => {
    const cmd = await brightsyAdapter.buildTurn(
      { ...baseThread, planMode: true },
      { prompt: 'plan feature' },
    );
    expect(cmd.args[cmd.args.indexOf('--mode') + 1]).toBe('plan');
  });

  it('passes agent targets via --agent', async () => {
    const cmd = await brightsyAdapter.buildTurn(
      { ...baseThread, model: encodeBrightsyTarget('agent', 'agent-123') },
      { prompt: 'hi' },
    );
    expect(cmd.args[cmd.args.indexOf('--agent') + 1]).toBe('agent-123');
    expect(cmd.args).not.toContain('--model');
  });

  it('passes model targets via --model in ask mode', async () => {
    const cmd = await brightsyAdapter.buildTurn(
      { ...baseThread, model: encodeBrightsyTarget('model', 'claude_sonnet_latest') },
      { prompt: 'hi' },
    );
    expect(cmd.args[cmd.args.indexOf('--model') + 1]).toBe('claude_sonnet_latest');
    expect(cmd.args).not.toContain('--agent');
    expect(cmd.args[cmd.args.indexOf('--mode') + 1]).toBe('ask');
  });

  it('uses agent mode for agent targets (non-plan)', async () => {
    const cmd = await brightsyAdapter.buildTurn(
      { ...baseThread, model: encodeBrightsyTarget('agent', 'agent-123') },
      { prompt: 'hi' },
    );
    expect(cmd.args[cmd.args.indexOf('--mode') + 1]).toBe('agent');
  });
});

describe('brightsyAdapter.parseEvent', () => {
  it('maps text events to stdout', () => {
    const event = brightsyAdapter.parseEvent(JSON.stringify({ type: 'text', text: 'pong' }));
    expect(event).toEqual({ type: 'stdout', data: 'pong' });
  });

  it('maps error events to stderr and stdout (so the UI shows them)', () => {
    const event = brightsyAdapter.parseEvent(
      JSON.stringify({ type: 'error', error: 'Not logged in' }),
    );
    expect(event).toEqual([
      { type: 'stderr', data: 'Not logged in' },
      { type: 'stdout', data: 'Error: Not logged in' },
    ]);
  });

  it('maps nested error objects to a readable message', () => {
    expect(
      brightsyAdapter.parseEvent(
        JSON.stringify({ type: 'error', error: { message: 'Invalid API key' } }),
      ),
    ).toEqual([
      { type: 'stderr', data: 'Invalid API key' },
      { type: 'stdout', data: 'Error: Invalid API key' },
    ]);
  });

  it('extracts token usage', () => {
    const event = brightsyAdapter.parseEvent(
      JSON.stringify({
        type: 'usage',
        usage: {
          prompt_tokens: 19618,
          prompt_tokens_details: { cached_tokens: 100 },
          completion_tokens: 29,
        },
      }),
    );
    expect(event).toEqual({
      type: 'usage',
      data: { inputTokens: 19618, outputTokens: 29, cacheReadTokens: 100 },
    });
  });

  it('maps tool_use / tool_result NDJSON to agent events', () => {
    expect(
      brightsyAdapter.parseEvent(
        JSON.stringify({
          type: 'tool_use',
          id: 'get_record_types_0',
          name: 'get_record_types',
          input: {},
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      id: 'get_record_types_0',
      name: 'get_record_types',
      input: {},
    });
    expect(
      brightsyAdapter.parseEvent(
        JSON.stringify({
          type: 'tool_result',
          id: 'get_record_types_0',
          content: '{"ok":true}',
        }),
      ),
    ).toEqual({
      type: 'tool_result',
      id: 'get_record_types_0',
      content: '{"ok":true}',
      isError: false,
    });
  });

  it('maps legacy tool events to tool_result', () => {
    expect(
      brightsyAdapter.parseEvent(
        JSON.stringify({ type: 'tool', tool_call_id: 'x', content: 'out' }),
      ),
    ).toEqual({
      type: 'tool_result',
      id: 'x',
      content: 'out',
      isError: false,
    });
  });

  it('maps thinking events', () => {
    expect(
      brightsyAdapter.parseEvent(JSON.stringify({ type: 'thinking', text: 'hmm' })),
    ).toEqual({ type: 'thinking', data: 'hmm' });
  });

  it('ignores done events', () => {
    expect(brightsyAdapter.parseEvent(JSON.stringify({ type: 'done' }))).toBeNull();
  });

  it('falls back to stdout for non-JSON lines', () => {
    expect(brightsyAdapter.parseEvent('plain text')).toEqual({
      type: 'stdout',
      data: 'plain text',
    });
  });
});

describe('brightsyAdapter.resolveSessionId', () => {
  it('always returns null so Sideboard seeds each turn from history', async () => {
    await expect(brightsyAdapter.resolveSessionId('/tmp/wt', 'cached')).resolves.toBeNull();
  });
});
