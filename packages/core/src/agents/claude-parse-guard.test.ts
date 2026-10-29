import { describe, expect, it } from 'vitest';
import { claudeAdapter } from './claude.js';

describe('claudeAdapter.parseEvent guards', () => {
  it('does not let a subagent usage snapshot replace the parent turn', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'assistant',
        parent_tool_use_id: 'toolu_task',
        message: {
          usage: { input_tokens: 20, output_tokens: 4 },
          content: [{ type: 'text', text: 'sub' }],
        },
      }),
    );
    const list = Array.isArray(event) ? event : event ? [event] : [];
    expect(list.some((e) => e.type === 'usage')).toBe(false);
    expect(list).toContainEqual({ type: 'stdout', data: 'sub', parentId: 'toolu_task' });
  });

  it('keeps a normal answer that mentions rate limits off the error channel', () => {
    const answer = `Added rate limiting to the login endpoint and fixed the 401 Unauthorized responses. ${'detail '.repeat(40)}`;
    expect(answer.length).toBeGreaterThan(300);
    expect(
      claudeAdapter.parseEvent(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: answer,
        }),
      ),
    ).toEqual({ type: 'stdout', data: answer });
  });
});
