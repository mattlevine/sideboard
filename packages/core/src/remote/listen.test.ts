import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { ensureRemoteCoordinator } from '../store/global-workspace.js';
import { readThread, updateThread } from '../store/thread-store.js';
import { handleRemoteInbound, REMOTE_STOPPED_REPLY } from './listen.js';

describe('handleRemoteInbound interrupt', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-remote-interrupt-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('stops a running phone turn before the handle queue', async () => {
    const thread = ensureRemoteCoordinator('phone-1', 'claude');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waits = 0;
    const send = vi.spyOn(Orchestrator.prototype, 'send').mockImplementation(async (id) => {
      updateThread(String(id), { status: 'running' });
      return readThread(String(id))!;
    });
    vi.spyOn(Orchestrator.prototype, 'waitForTurn').mockImplementation(async (id) => {
      waits += 1;
      if (waits === 1) await gate;
      else updateThread(String(id), { status: 'idle' });
      return readThread(String(id))!;
    });
    vi.spyOn(Orchestrator.prototype, 'getTurnResult').mockReturnValue({
      text: 'all done',
      status: 'idle',
      taskState: 'completed',
      sessionId: null,
      lastError: null,
      stillRunning: false,
      progress: null,
      lastActivityAt: null,
      usage: null,
    });
    const stop = vi.spyOn(Orchestrator.prototype, 'stop').mockImplementation((id) => {
      release();
      updateThread(String(id), { status: 'stopped', queue: [] });
      return readThread(String(id))!;
    });
    const replies: string[] = [];
    const outbound = (msg: { type: string; text?: string }) => {
      if (msg.type === 'assistant' && msg.text) replies.push(msg.text);
    };

    handleRemoteInbound('first', { deviceId: 'phone-1', agent: 'claude', onOutbound: outbound });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(stop).not.toHaveBeenCalled();

    handleRemoteInbound('second', { deviceId: 'phone-1', agent: 'claude', onOutbound: outbound });
    expect(stop).toHaveBeenCalledWith(thread.id, { clearQueue: true });

    await vi.waitFor(() => expect(replies).toEqual(['all done']));
    expect(send).toHaveBeenLastCalledWith(thread.id, 'Phone\n\nsecond');
  });

  it('replies to stop without waiting out the in-flight turn', async () => {
    ensureRemoteCoordinator('phone-2', 'claude');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(Orchestrator.prototype, 'send').mockImplementation(async (id) => {
      updateThread(String(id), { status: 'running' });
      return readThread(String(id))!;
    });
    vi.spyOn(Orchestrator.prototype, 'waitForTurn').mockImplementation(async (id) => {
      await gate;
      return readThread(String(id))!;
    });
    const stop = vi.spyOn(Orchestrator.prototype, 'stop').mockImplementation((id) => {
      release();
      updateThread(String(id), { status: 'stopped', queue: [] });
      return readThread(String(id))!;
    });
    const replies: string[] = [];

    handleRemoteInbound('first', {
      deviceId: 'phone-2',
      agent: 'claude',
      onOutbound: () => undefined,
    });
    await vi.waitFor(() => expect(readThread(ensureRemoteCoordinator('phone-2', 'claude').id)?.status).toBe('running'));

    handleRemoteInbound('stop', {
      deviceId: 'phone-2',
      agent: 'claude',
      onOutbound: (msg) => {
        if (msg.type === 'assistant') replies.push(msg.text);
      },
    });
    expect(stop).toHaveBeenCalled();
    await vi.waitFor(() => expect(replies).toEqual([REMOTE_STOPPED_REPLY]));
  });
});
