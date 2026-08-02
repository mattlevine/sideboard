import { describe, expect, it } from 'vitest';
import {
  cursorSdkMessageToEvents,
  parseCursorRunnerLine,
} from './cursor-events.js';

describe('cursorSdkMessageToEvents', () => {
  it('maps system init to session_id', () => {
    expect(
      cursorSdkMessageToEvents({
        type: 'system',
        agent_id: 'agent-123',
      }),
    ).toEqual([{ type: 'session_id', data: 'agent-123' }]);
  });

  it('maps thinking and assistant text', () => {
    expect(
      cursorSdkMessageToEvents({
        type: 'thinking',
        text: 'planning…',
      }),
    ).toEqual([{ type: 'thinking', data: 'planning…' }]);

    expect(
      cursorSdkMessageToEvents({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
        },
      }),
    ).toEqual([{ type: 'stdout', data: 'Hello' }]);
  });

  it('maps tool_call running/completed like Claude tool events', () => {
    expect(
      cursorSdkMessageToEvents({
        type: 'tool_call',
        call_id: 'c1',
        name: 'Read',
        status: 'running',
        args: { path: 'a.ts' },
      }),
    ).toEqual([
      {
        type: 'tool_use',
        id: 'c1',
        name: 'Read',
        input: { path: 'a.ts' },
      },
    ]);

    expect(
      cursorSdkMessageToEvents({
        type: 'tool_call',
        call_id: 'c1',
        name: 'Read',
        status: 'completed',
        result: 'ok',
      }),
    ).toEqual([{ type: 'tool_result', id: 'c1', content: 'ok', isError: false }]);
  });

  it('maps usage', () => {
    expect(
      cursorSdkMessageToEvents({
        type: 'usage',
        usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 },
      }),
    ).toEqual([
      {
        type: 'usage',
        data: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2, cacheWriteTokens: undefined },
      },
    ]);
  });
});

describe('parseCursorRunnerLine', () => {
  it('parses AgentEvent NDJSON', () => {
    expect(parseCursorRunnerLine('{"type":"stdout","data":"hi"}')).toEqual({
      type: 'stdout',
      data: 'hi',
    });
  });

  it('falls back to stdout for non-JSON', () => {
    expect(parseCursorRunnerLine('plain')).toEqual({ type: 'stdout', data: 'plain' });
  });
});
