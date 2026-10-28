import { describe, expect, it } from 'vitest';
import { buildClaudeSdkQueryOptions } from './claude-query-options.js';
import type { ClaudeTurnRequest } from './claude-turn-request.js';

function request(overrides: Partial<ClaudeTurnRequest> = {}): ClaudeTurnRequest {
  return {
    prompt: 'hi',
    cwd: '/tmp/wt',
    permissionMode: 'acceptEdits',
    claudePath: '/usr/bin/claude',
    mcpServers: {},
    allowedTools: ['Read'],
    agentRpc: { url: 'ws://127.0.0.1:9/agent-rpc', authToken: 'tok' },
    ...overrides,
  };
}

describe('buildClaudeSdkQueryOptions', () => {
  it('uses the Claude Code preset and appends per-turn reminders', () => {
    const abort = new AbortController();
    const options = buildClaudeSdkQueryOptions(
      request({ systemPrompt: 'stay in the worktree', model: 'opus', effort: 'high' }),
      { sideboard: { command: 'node' } },
      abort,
    );
    expect(options.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: 'stay in the worktree',
    });
    expect(options).not.toHaveProperty('appendSystemPrompt');
    expect(options.strictMcpConfig).toBe(true);
    expect(options).not.toHaveProperty('settingSources');
    expect(options.model).toBe('opus');
    expect(options.effort).toBe('high');
    expect(options.abortController).toBe(abort);
  });

  it('passes Chrome as a boolean CLI flag', () => {
    const options = buildClaudeSdkQueryOptions(
      request({ chrome: true }),
      {},
      new AbortController(),
    );
    expect(options.extraArgs).toEqual({ chrome: null });
    expect(options).not.toHaveProperty('chrome');
  });
});
