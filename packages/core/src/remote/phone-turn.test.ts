import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { ensureRemoteCoordinator } from '../store/global-workspace.js';
import { readThread, updateThread } from '../store/thread-store.js';
import { waitForPhoneTurn } from './phone-turn.js';

describe('waitForPhoneTurn', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-phone-turn-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('keeps waiting while a steered prompt is stopped in the queue', async () => {
    vi.useFakeTimers();
    const thread = ensureRemoteCoordinator('phone-steer-gap', 'claude');
    updateThread(thread.id, { status: 'stopped', queue: ['Phone\n\nnext'] });
    const wait = vi.spyOn(Orchestrator.prototype, 'waitForTurn').mockImplementation(async (id) => {
      updateThread(String(id), { status: 'idle', queue: [] });
      return readThread(String(id))!;
    });

    const done = waitForPhoneTurn(thread.id, () => true);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(wait).not.toHaveBeenCalled();

    updateThread(thread.id, { status: 'running', queue: [] });
    await vi.advanceTimersByTimeAsync(40);
    await done;
    expect(wait).toHaveBeenCalledTimes(1);
  });
});
