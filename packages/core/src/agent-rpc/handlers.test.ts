import { describe, expect, it, vi } from 'vitest';
import {
  handleJobStop,
  handleJobWait,
  handlePresentArtifact,
  handleRuntimePing,
  handleTurnWait,
  presentArtifactResult,
} from './handlers.js';
import { AGENT_RPC_PROTOCOL_VERSION } from './protocol.js';
import type { WaitForJobResult } from '../mcp/wait-for-job.js';
import type { WaitForTurnToolResult } from '../mcp/wait-for-turn.js';

describe('agent-rpc handlers', () => {
  it('pings with the protocol version', async () => {
    const result = await handleRuntimePing({}, {
      cwd: '/tmp',
      notify: () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(result.protocolVersion).toBe(AGENT_RPC_PROTOCOL_VERSION);
    expect(result.pid).toBe(process.pid);
  });

  it('accepts presentArtifact without echoing content', async () => {
    const result = await handlePresentArtifact(
      {
        title: 'Doc',
        type: 'html',
        content: '<h1>secret</h1>',
        artifact_id: 'a1',
      },
      { cwd: '/tmp', notify: () => undefined },
    );
    expect(result.ok).toBe(true);
    expect(result.artifact_id).toBe('a1');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('rejects presentArtifact without a title', async () => {
    await expect(
      handlePresentArtifact({ type: 'html', content: '' }, {
        cwd: '/tmp',
        notify: () => undefined,
      }),
    ).rejects.toThrow(/title/);
  });

  it('holds job.wait until stillRunning is false and notifies progress', async () => {
    const notifies: unknown[] = [];
    const slices: WaitForJobResult[] = [
      {
        stillRunning: true,
        ok: false,
        failed: false,
        status: 'running',
        id: 'pack',
        delta: 'a',
        progress: 'building',
      },
      {
        stillRunning: false,
        ok: true,
        failed: false,
        status: 'ok',
        id: 'pack',
        delta: 'done',
        progress: 'ok',
      },
    ];
    const waitFn = vi.fn(async (_cwd: string, _id: string) => slices.shift()!);
    const result = await handleJobWait(
      { id: 'pack', cwd: '/work' },
      { cwd: '/', notify: (_m, p) => notifies.push(p) },
      waitFn,
    );
    expect(result.ok).toBe(true);
    expect(result.stillRunning).toBe(false);
    expect(waitFn).toHaveBeenCalledTimes(2);
    expect(notifies).toHaveLength(1);
    expect(waitFn.mock.calls[0]?.[0]).toBe('/work');
  });

  it('job.wait requires an absolute cwd in params (desktop cwd is not the worktree)', async () => {
    const waitFn = vi.fn(async (_cwd: string, id: string) => ({
      stillRunning: false,
      ok: true,
      failed: false,
      status: 'ok' as const,
      id,
      delta: '',
      progress: 'ok',
    }));
    const ctx = { cwd: '/', notify: () => undefined };
    await handleJobWait({ id: 'pack', cwd: '/repo/wt' }, ctx, waitFn);
    expect(waitFn.mock.calls[0]?.[0]).toBe('/repo/wt');
    await expect(handleJobWait({ id: 'pack' }, ctx, waitFn)).rejects.toMatchObject({
      rpcCode: -32602,
    });
    await expect(handleJobWait({ id: 'pack', cwd: 'wt' }, ctx, waitFn)).rejects.toMatchObject({
      rpcCode: -32602,
    });
  });

  it('job.stop requires an absolute cwd in params', async () => {
    const ctx = { cwd: '/', notify: () => undefined };
    await expect(handleJobStop({ id: 'pack' }, ctx)).rejects.toMatchObject({
      rpcCode: -32602,
    });
    await expect(handleJobStop({ id: 'pack', cwd: 'wt' }, ctx)).rejects.toMatchObject({
      rpcCode: -32602,
    });
  });

  it('holds turn.wait until stillRunning is false and notifies progress', async () => {
    const notifies: unknown[] = [];
    const slices: WaitForTurnToolResult[] = [
      {
        id: 'child-1',
        status: 'running',
        taskState: 'working',
        text: '',
        lastError: null,
        stillRunning: true,
        progress: 'Read foo.ts',
        lastActivityAt: 't1',
        hint: 'Child is still working. Call wait_for_turn again. Do not send_to_thread a check-in (that steers / interrupts) or assume a hang while progress is updating.',
        incomplete: false,
      },
      {
        id: 'child-1',
        status: 'idle',
        taskState: 'completed',
        text: 'done',
        lastError: null,
        stillRunning: false,
        progress: null,
        lastActivityAt: 't2',
        hint: undefined,
        incomplete: false,
      },
    ];
    const waitFn = vi.fn(async (_ref: string) => slices.shift()!);
    const result = await handleTurnWait(
      { ref: 'child-1' },
      { cwd: '/', notify: (_m, p) => notifies.push(p) },
      waitFn,
    );
    expect(result.stillRunning).toBe(false);
    expect(result.taskState).toBe('completed');
    expect(result.text).toBe('done');
    expect(waitFn).toHaveBeenCalledTimes(2);
    expect(notifies).toHaveLength(1);
    expect(waitFn.mock.calls[0]?.[0]).toBe('child-1');
  });

  it('turn.wait requires ref', async () => {
    const waitFn = vi.fn(async () => ({
      id: 'x',
      status: 'idle',
      taskState: 'completed' as const,
      text: '',
      lastError: null,
      stillRunning: false,
      progress: null,
      lastActivityAt: null,
      hint: undefined,
      incomplete: false,
    }));
    await expect(
      handleTurnWait({}, { cwd: '/', notify: () => undefined }, waitFn),
    ).rejects.toMatchObject({ rpcCode: -32602 });
    expect(waitFn).not.toHaveBeenCalled();
  });
});

describe('presentArtifactResult', () => {
  it('defaults log mode to append', () => {
    const result = presentArtifactResult({
      title: 'Log',
      type: 'log',
      artifact_id: 'j1',
    });
    expect(result.mode).toBe('append');
  });
});
