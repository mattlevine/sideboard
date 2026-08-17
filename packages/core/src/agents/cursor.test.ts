import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  beforeEach(() => {
    vi.stubEnv('SIDEBOARD_APP_DATA', mkdtempSync(join(tmpdir(), 'sideboard-cursor-')));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs the SDK runner via node when available (else Electron RUN_AS_NODE)', async () => {
    const cmd = await cursorAdapter.buildTurn(baseThread, { prompt: 'hi' });
    expect(cmd.args.at(-1)).toMatch(/cursor-runner\.(js|cjs|ts)$/);
    expect(cmd.cwd).toBe('/tmp/wt');
    expect(JSON.parse(cmd.stdin!)).toMatchObject({
      prompt: 'hi',
      cwd: '/tmp/wt',
    });
    // Dev machines usually have `node` on PATH; Electron-only hosts fall back
    // to Electron-as-Node (wrapped in `/bin/sh` so nested Cursor Electron cannot
    // leak crashpad env into the runner).
    if (cmd.env?.ELECTRON_RUN_AS_NODE === '1') {
      expect(cmd.file === process.execPath || cmd.file === '/bin/sh').toBe(true);
    } else {
      expect(cmd.file).toMatch(/node/);
      expect(cmd.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    }
  });

  it('injects Sideboard MCP into the Cursor turn request', async () => {
    const cmd = await cursorAdapter.buildTurn(baseThread, { prompt: 'list threads' });
    const req = JSON.parse(cmd.stdin!) as {
      mcpServers?: Record<string, { command: string; args?: string[] }>;
    };
    expect(req.mcpServers?.sideboard).toBeTruthy();
    expect(req.mcpServers!.sideboard.command).toBeTruthy();
  });

  it('omits cachedPrefix on resumed Cursor sessions', async () => {
    const cmd = await cursorAdapter.buildTurn(
      { ...baseThread, sessionId: 'agent-abc' } as typeof baseThread,
      { cachedPrefix: 'should not appear', prompt: 'next step' },
    );
    const req = JSON.parse(cmd.stdin!) as { prompt: string; agentId?: string };
    expect(req.prompt).toBe('next step');
    expect(req.prompt).not.toContain('should not appear');
    expect(req.agentId).toBe('agent-abc');
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
    ).toEqual([
      {
        type: 'tool_use',
        id: 'c1',
        name: 'Read',
        input: undefined,
      },
      { type: 'tool_result', id: 'c1', content: 'ok', isError: false },
    ]);
  });

  it('normalizes Cursor MCP present_artifact nested args/result', () => {
    const html = '<!DOCTYPE html><html><body><h1>Hi</h1></body></html>';
    const payload = JSON.stringify({
      ok: true,
      artifact_id: 'a1',
      title: 'Hi',
      type: 'html',
      content: html,
      message: 'Presented.',
    });

    expect(
      cursorSdkMessageToEvents({
        type: 'tool_call',
        call_id: 'mcp1',
        name: 'mcp',
        status: 'running',
        args: {
          providerIdentifier: 'sideboard',
          toolName: 'present_artifact',
          args: { title: 'Hi', type: 'html', content: html, artifact_id: 'a1' },
        },
      }),
    ).toEqual([
      {
        type: 'tool_use',
        id: 'mcp1',
        name: 'mcp__sideboard__present_artifact',
        input: { title: 'Hi', type: 'html', content: html, artifact_id: 'a1' },
      },
    ]);

    expect(
      cursorSdkMessageToEvents({
        type: 'tool_call',
        call_id: 'mcp1',
        name: 'mcp',
        status: 'completed',
        args: {
          providerIdentifier: 'sideboard',
          toolName: 'present_artifact',
          args: { title: 'Hi', type: 'html', content: html, artifact_id: 'a1' },
        },
        result: {
          status: 'success',
          value: {
            content: [{ text: { text: payload } }],
            isError: false,
          },
        },
      }),
    ).toEqual([
      {
        type: 'tool_use',
        id: 'mcp1',
        name: 'mcp__sideboard__present_artifact',
        input: { title: 'Hi', type: 'html', content: html, artifact_id: 'a1' },
      },
      {
        type: 'tool_result',
        id: 'mcp1',
        content: payload,
        isError: false,
      },
    ]);
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
        scope: 'request',
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
