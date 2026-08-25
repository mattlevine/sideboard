import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cursorAdapter } from './cursor.js';
import {
  cursorDeltaToEvents,
  cursorSdkMessageToEvents,
  costUsdFromRunSnapshot,
  cursorGetUsageRunId,
  fetchCursorTurnCostUsd,
  isCursorUsageUnavailableError,
  parseCursorRunnerLine,
  preferredCursorCostCents,
  turnCostUsdFromCursorUsage,
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
      threadId: 't1',
    });
    // Dev machines usually have `node` on PATH; Electron-only hosts fall back
    // to Electron-as-Node (wrapped in `/bin/sh` so nested Cursor Electron cannot
    // leak crashpad env into the runner). RUN_AS_NODE stays in the sh script,
    // not spawn env.
    if (cmd.file === '/bin/sh') {
      expect(cmd.args?.some((a) => a.includes('ELECTRON_RUN_AS_NODE'))).toBe(true);
      expect(cmd.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    } else if (cmd.env?.ELECTRON_RUN_AS_NODE === '1') {
      expect(cmd.file).toBe(process.execPath);
    } else {
      expect(cmd.file).toMatch(/node/);
      expect(cmd.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    }
  });

  it('injects Sideboard MCP into the Cursor turn request', async () => {
    const cmd = await cursorAdapter.buildTurn(baseThread, { prompt: 'list threads' });
    const req = JSON.parse(cmd.stdin!) as {
      mcpServers?: Record<string, { type?: string; command: string; args?: string[] }>;
    };
    expect(req.mcpServers?.sideboard).toBeTruthy();
    expect(req.mcpServers!.sideboard.type).toBe('stdio');
    expect(req.mcpServers!.sideboard.command).toBeTruthy();
    expect(req.mcpServers!.sideboard.command).not.toBe('/bin/sh');
    expect(JSON.stringify(req.mcpServers!.sideboard)).not.toContain('ELECTRON_RUN_AS_NODE');
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
        call_id: 'sh1',
        name: 'Shell',
        status: 'running',
        args: { command: 'pnpm build' },
        result: 'bundling…\n',
      }),
    ).toEqual([
      {
        type: 'tool_use',
        id: 'sh1',
        name: 'Shell',
        input: { command: 'pnpm build' },
      },
      {
        type: 'tool_result',
        id: 'sh1',
        content: 'bundling…\n',
        partial: true,
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

describe('cursorDeltaToEvents', () => {
  it('maps nested task thinking and tools onto the parent call id', () => {
    expect(
      cursorDeltaToEvents({
        type: 'tool-call-delta',
        callId: 'task1',
        taskUpdate: { type: 'thinking-delta', text: 'scan login' },
      }),
    ).toEqual([{ type: 'thinking', data: 'scan login', parentId: 'task1' }]);

    expect(
      cursorDeltaToEvents({
        type: 'tool-call-delta',
        callId: 'task1',
        taskUpdate: {
          type: 'tool-call-started',
          callId: 'r1',
          toolCall: { type: 'readFile', args: { path: 'src/auth.ts' } },
        },
      }),
    ).toEqual([
      {
        type: 'tool_use',
        id: 'r1',
        name: 'readFile',
        input: { path: 'src/auth.ts' },
        parentId: 'task1',
      },
    ]);

    expect(
      cursorDeltaToEvents({
        type: 'tool-call-delta',
        callId: 'task1',
        taskUpdate: {
          type: 'tool-call-completed',
          callId: 'r1',
          toolCall: {
            type: 'readFile',
            args: { path: 'src/auth.ts' },
            result: 'ok',
          },
        },
      }),
    ).toEqual([
      {
        type: 'tool_use',
        id: 'r1',
        name: 'readFile',
        input: { path: 'src/auth.ts' },
        parentId: 'task1',
      },
      { type: 'tool_result', id: 'r1', content: 'ok', isError: false, parentId: 'task1' },
    ]);
  });

  it('ignores top-level text-delta so run.stream is not duplicated', () => {
    expect(cursorDeltaToEvents({ type: 'text-delta', text: 'Hello' })).toEqual([]);
    expect(cursorDeltaToEvents({ type: 'thinking-delta', text: 'hmm' })).toEqual([]);
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

describe('turnCostUsdFromCursorUsage', () => {
  it('prefers charged cents over raw', () => {
    expect(
      preferredCursorCostCents({ chargedCents: 1.5, rawCostCents: 9 }),
    ).toBe(1.5);
    expect(preferredCursorCostCents({ chargedCents: 0, rawCostCents: 4.2 })).toBe(4.2);
  });

  it('sums cost on newly appeared runs', () => {
    expect(
      turnCostUsdFromCursorUsage(
        {
          cost: { chargedCents: 10 },
          runs: [{ runId: 'a', cost: { chargedCents: 10 } }],
        },
        {
          cost: { chargedCents: 13 },
          runs: [
            { runId: 'a', cost: { chargedCents: 10 } },
            { runId: 'b', cost: { rawCostCents: 3 } },
          ],
        },
      ),
    ).toBe(0.03);
  });

  it('falls back to agent-level cents delta when runs lack cost', () => {
    expect(
      turnCostUsdFromCursorUsage(
        { cost: { chargedCents: 10 }, runs: [{ runId: 'a' }] },
        { cost: { chargedCents: 15.5 }, runs: [{ runId: 'a' }, { runId: 'b' }] },
      ),
    ).toBeCloseTo(0.055);
  });

  it('does not assign session-total cost without a before snapshot', () => {
    expect(
      turnCostUsdFromCursorUsage(null, {
        cost: { chargedCents: 42 },
        runs: [],
      }),
    ).toBeUndefined();
  });
});

describe('costUsdFromRunSnapshot', () => {
  it('reads cost from a matching run entry', () => {
    expect(
      costUsdFromRunSnapshot(
        {
          runs: [{ runId: 'usage-1', cost: { rawCostCents: 7 } }],
        },
        'usage-1',
      ),
    ).toBe(0.07);
  });
});

describe('cursorGetUsageRunId', () => {
  it('drops local stream run labels', () => {
    expect(cursorGetUsageRunId('run-abc')).toBeUndefined();
    expect(cursorGetUsageRunId('usage-uuid')).toBe('usage-uuid');
  });
});

describe('fetchCursorTurnCostUsd', () => {
  it('polls until cost appears', async () => {
    let calls = 0;
    const result = await fetchCursorTurnCostUsd(
      async () => {
        calls += 1;
        if (calls < 3) return { runs: [{ runId: 'usage-1' }] };
        return {
          runs: [{ runId: 'usage-1', cost: { chargedCents: 4 } }],
        };
      },
      { runs: [] },
      { runId: 'usage-1' },
    );
    expect(result).toBe(0.04);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('stops polling when billing API is unavailable', async () => {
    let calls = 0;
    const result = await fetchCursorTurnCostUsd(
      async () => {
        calls += 1;
        throw new Error('[feature_unavailable] This feature is not available for your account');
      },
      { runs: [] },
    );
    expect(result).toBeUndefined();
    expect(calls).toBe(1);
  });
});

describe('isCursorUsageUnavailableError', () => {
  it('detects feature_unavailable', () => {
    expect(
      isCursorUsageUnavailableError(
        new Error('[feature_unavailable] This feature is not available for your account'),
      ),
    ).toBe(true);
  });
});
