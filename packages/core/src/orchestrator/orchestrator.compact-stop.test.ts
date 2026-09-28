import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEmptyThread,
  readThread,
  writeThread,
} from '../store/thread-store.js';
import type { Thread } from '../types/thread.js';

const maybeCompactContext = vi.hoisted(() => vi.fn());
const spawnAgentTurn = vi.hoisted(() => vi.fn());

vi.mock('../composer/context-compact.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../composer/context-compact.js')>();
  return { ...actual, maybeCompactContext };
});

vi.mock('../agents/spawn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agents/spawn.js')>();
  return { ...actual, spawnAgentTurn };
});

import { Orchestrator } from './orchestrator.js';

describe('Orchestrator stop during compact', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-compact-stop-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    maybeCompactContext.mockReset();
    spawnAgentTurn.mockReset();
    spawnAgentTurn.mockResolvedValue({
      pid: 99,
      kill: vi.fn(),
      done: Promise.resolve({
        exitCode: 0,
        sessionId: null,
        assistantText: 'should not spawn',
        parts: [],
        usage: null,
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seedThread() {
    const worktreePath = join(dataDir, 'wt');
    mkdirSync(worktreePath, { recursive: true });
    const thread = createEmptyThread({
      title: 'Compact stop',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/compact-stop',
      worktreePath,
      repoPath: join(dataDir, 'repo'),
      agent: 'cursor',
      status: 'idle',
    });
    writeThread(thread);
    return thread;
  }

  it('appends the user prompt and emits turn_finished without spawning', async () => {
    const thread = seedThread();
    let releaseCompact!: () => void;
    maybeCompactContext.mockImplementation(
      (current: Thread) =>
        new Promise((resolve) => {
          releaseCompact = () => resolve({ didCompact: false, thread: current });
        }),
    );

    const orch = new Orchestrator();
    const events: Array<{ type: string; threadId?: string }> = [];
    orch.on((e) => {
      events.push({ type: e.type, threadId: 'threadId' in e ? e.threadId : undefined });
    });
    const internal = orch as unknown as {
      runTurn: (threadId: string, prompt: string) => Promise<void>;
      startingTurns: Set<string>;
    };

    const running = internal.runTurn(thread.id, 'fix leftover reap');
    await vi.waitFor(() => expect(maybeCompactContext).toHaveBeenCalled());
    expect(internal.startingTurns.has(thread.id)).toBe(true);

    orch.stop(thread.id, { clearQueue: false });
    releaseCompact();
    await running;

    expect(spawnAgentTurn).not.toHaveBeenCalled();
    const next = readThread(thread.id)!;
    expect(next.status).toBe('stopped');
    expect(next.messages.some((m) => m.role === 'user' && m.text === 'fix leftover reap')).toBe(
      true,
    );
    expect(events.some((e) => e.type === 'turn_started' && e.threadId === thread.id)).toBe(true);
    expect(events.some((e) => e.type === 'turn_finished' && e.threadId === thread.id)).toBe(true);
  });
});
