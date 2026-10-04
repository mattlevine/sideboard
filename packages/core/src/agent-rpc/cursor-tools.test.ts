import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sideboardCursorRpcTools } from './cursor-tools.js';
import { createAgentRpcDispatcher, handleJobWait, handleTurnWait, type JobWaitFn } from './handlers.js';
import type { AgentRpcConnect } from './metadata.js';
import { AgentRpcServer } from './server.js';

describe('sideboardCursorRpcTools', () => {
  let dataDir: string;
  let server: AgentRpcServer;
  let rpc: AgentRpcConnect;
  const seenWaits: Array<{ cwd: string; id: string }> = [];

  const waitFn: JobWaitFn = async (cwd, id) => {
    seenWaits.push({ cwd, id });
    const slices = [
      { stillRunning: true, status: 'running' as const, delta: 'a' },
      { stillRunning: false, status: 'ok' as const, delta: 'done' },
    ];
    const slice = slices[Math.min(seenWaits.length - 1, 1)]!;
    return {
      ...slice,
      ok: !slice.stillRunning,
      failed: false,
      id,
      progress: slice.status,
    };
  };

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-cursor-rpc-tools-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    seenWaits.length = 0;
    server = new AgentRpcServer({
      cwd: () => '/',
      handlers: {
        ...createAgentRpcDispatcher(),
        'job.wait': (params, ctx) => handleJobWait(params, ctx, waitFn),
        'turn.wait': (params, ctx) =>
          handleTurnWait(params, ctx, async (ref) => ({
            id: ref,
            status: 'idle',
            taskState: 'completed',
            text: 'child done',
            lastError: null,
            stillRunning: false,
            progress: null,
            lastActivityAt: null,
            usage: null,
            hint: undefined,
            incomplete: false,
          })),
      },
    });
    const meta = await server.listen({ host: '127.0.0.1', port: 0 });
    rpc = { url: meta.transports[0]!.url, authToken: meta.authToken };
  });

  afterEach(async () => {
    await server.close();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('registers the Cursor worktree pilot set', () => {
    const tools = sideboardCursorRpcTools({ cwd: '/tmp/wt', rpc });
    expect(Object.keys(tools).sort()).toEqual(['present_artifact', 'stop_job', 'wait_for_job']);
  });

  it('registers wait_for_turn only for orchestration Cursor', () => {
    const tools = sideboardCursorRpcTools({
      cwd: '/tmp/wt',
      rpc,
      includeWaitForTurn: true,
    });
    expect(Object.keys(tools).sort()).toEqual([
      'present_artifact',
      'stop_job',
      'wait_for_job',
      'wait_for_turn',
    ]);
  });

  it('present_artifact returns a compact ok payload without echoing content', async () => {
    const tools = sideboardCursorRpcTools({ cwd: '/tmp/wt', rpc });
    const raw = await tools.present_artifact.execute({
      title: 'Doc',
      type: 'html',
      content: '<p>x</p>',
      artifact_id: 't1',
    });
    const parsed = JSON.parse(raw) as { ok: boolean; artifact_id: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.artifact_id).toBe('t1');
    expect(raw).not.toContain('<p>x</p>');
  });

  it('wait_for_job sends the worktree cwd and forwards runtime.progress', async () => {
    const progress: Array<{ params: unknown; toolCallId?: string }> = [];
    const tools = sideboardCursorRpcTools({
      cwd: '/tmp/wt',
      rpc,
      onProgress: (params, toolCallId) => progress.push({ params, toolCallId }),
    });
    const raw = await tools.wait_for_job.execute({ id: 'pack' }, { toolCallId: 'call-1' });
    const parsed = JSON.parse(raw) as { ok: boolean; stillRunning: boolean; delta: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.stillRunning).toBe(false);
    expect(parsed.delta).toBe('done');
    expect(seenWaits.every((w) => w.cwd === '/tmp/wt')).toBe(true);
    expect(seenWaits.length).toBe(2);
    expect(progress).toHaveLength(1);
    expect(progress[0]?.toolCallId).toBe('call-1');
  });

  it('wait_for_turn calls turn.wait over the socket', async () => {
    const tools = sideboardCursorRpcTools({
      cwd: '/tmp/wt',
      rpc,
      includeWaitForTurn: true,
    });
    const raw = await tools.wait_for_turn!.execute({ ref: 'child-1' });
    const parsed = JSON.parse(raw) as { stillRunning: boolean; text: string };
    expect(parsed.stillRunning).toBe(false);
    expect(parsed.text).toBe('child done');
  });

  it('a dead runtime surfaces as a tool error payload, not a thrown exception', async () => {
    const tools = sideboardCursorRpcTools({
      cwd: '/tmp/wt',
      rpc: { url: 'ws://127.0.0.1:1/agent-rpc', authToken: 'x' },
    });
    const raw = await tools.wait_for_job.execute({ id: 'pack' });
    const parsed = JSON.parse(raw) as { ok: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeTruthy();
  });
});
