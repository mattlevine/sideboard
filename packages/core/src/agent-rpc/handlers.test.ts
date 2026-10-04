import { describe, expect, it, vi } from 'vitest';
import {
  handleJobStop,
  handleJobWait,
  handlePresentArtifact,
  handleRuntimePing,
  presentArtifactResult,
} from './handlers.js';
import { AGENT_RPC_PROTOCOL_VERSION } from './protocol.js';
import type { WaitForJobResult } from '../mcp/wait-for-job.js';

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
