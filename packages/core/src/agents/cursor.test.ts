import { describe, expect, it } from 'vitest';
import { cursorAdapter } from './cursor.js';
import {
  cursorSdkMessageToEvents,
  parseCursorRunnerLine,
} from './cursor-events.js';
import type { Thread } from '../types/thread.js';

const baseThread = {
  id: 't1',
  worktreePath: '/tmp/wt',
  sessionId: null,
  model: null,
  effort: 'high',
    fast: false,
  planMode: false,
  agent: 'cursor',
} as unknown as Thread;

describe('cursor model helpers', () => {
  it('treats null/default/auto as Auto', async () => {
    const { isCursorAutoModel, resolveCursorModelId } = await import('./cursor.js');
    expect(isCursorAutoModel(null)).toBe(true);
    expect(isCursorAutoModel('default')).toBe(true);
    expect(isCursorAutoModel('auto')).toBe(true);
    expect(isCursorAutoModel('composer-2.5')).toBe(false);
    expect(resolveCursorModelId(null)).toBe('default');
    expect(resolveCursorModelId('composer-2.5')).toBe('composer-2.5');
  });
});

describe('cursorAdapter.buildTurn', () => {
  it('runs the SDK runner via node when available (else Electron RUN_AS_NODE)', async () => {
    const cmd = await cursorAdapter.buildTurn(baseThread, { prompt: 'hi' });
    expect(cmd.args.at(-1)).toMatch(/cursor-runner\.(js|cjs|ts)$/);
    expect(cmd.cwd).toBe('/tmp/wt');
    expect(JSON.parse(cmd.stdin!)).toMatchObject({
      prompt: 'hi',
      cwd: '/tmp/wt',
    });
    // Dev machines usually have `node` on PATH; Electron-only hosts fall back.
    if (cmd.file === process.execPath) {
      expect(cmd.env?.ELECTRON_RUN_AS_NODE).toBe('1');
    } else {
      expect(cmd.file).toMatch(/node/);
      expect(cmd.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    }
  });
});

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

  it('maps ERROR status and error events to stderr', () => {
    expect(
      cursorSdkMessageToEvents({
        type: 'status',
        status: 'ERROR',
        message: 'Invalid User API Key' as never,
      }),
    ).toEqual([{ type: 'stderr', data: 'Invalid User API Key' }]);

    expect(
      cursorSdkMessageToEvents({
        type: 'error',
        error: { message: 'Model unavailable' },
      } as never),
    ).toEqual([{ type: 'stderr', data: 'Model unavailable' }]);
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
