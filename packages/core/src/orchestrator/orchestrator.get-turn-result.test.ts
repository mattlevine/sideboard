import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { threadFilePath } from '../store/paths.js';
import { createEmptyThread, writeThread } from '../store/thread-store.js';
import { Orchestrator } from './orchestrator.js';

function stampUpdatedAt(threadId: string, updatedAt: string): void {
  const path = threadFilePath(threadId);
  const next = { ...JSON.parse(readFileSync(path, 'utf8')), updatedAt };
  writeFileSync(path, JSON.stringify(next, null, 2));
  const old = new Date(updatedAt);
  utimesSync(path, old, old);
}

describe('Orchestrator.getTurnResult', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-turn-result-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seed(opts: {
    status: 'idle' | 'error' | 'running' | 'queued' | 'stopped';
    lastError?: string | null;
    agentText?: string;
    queue?: string[];
  }) {
    const worktreePath = join(dataDir, 'wt');
    mkdirSync(worktreePath, { recursive: true });
    const thread = createEmptyThread({
      title: 'Review',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/review',
      worktreePath,
      repoPath: join(dataDir, 'repo'),
      agent: 'cursor',
      status: opts.status,
    });
    thread.lastError = opts.lastError ?? null;
    if (opts.queue) thread.queue = opts.queue;
    if (opts.agentText) {
      thread.messages.push({
        role: 'agent',
        text: opts.agentText,
        ts: new Date().toISOString(),
      });
    }
    writeThread(thread);
    return thread;
  }

  it('fills text from lastError when the turn failed with no agent message', () => {
    const thread = seed({
      status: 'error',
      lastError:
        'Cursor runner crashed in Node (Homebrew Node + shared libuv). Install Node 22 LTS (`brew install node@22`) and retry.',
    });
    const result = new Orchestrator().getTurnResult(thread.id);
    expect(result.status).toBe('error');
    expect(result.lastError).toMatch(/shared libuv/);
    expect(result.text).toBe(result.lastError);
    expect(result.stillRunning).toBe(false);
  });

  it('keeps assistant text when present and still returns lastError', () => {
    const thread = seed({
      status: 'error',
      lastError: 'exit 1: boom',
      agentText: 'partial review',
    });
    const result = new Orchestrator().getTurnResult(thread.id);
    expect(result.text).toBe('partial review');
    expect(result.lastError).toBe('exit 1: boom');
  });

  it('surfaces lastError when the child stopped with no assistant text', () => {
    const thread = seed({
      status: 'stopped',
      lastError: 'Process died (agent exited)',
    });
    const result = new Orchestrator().getTurnResult(thread.id);
    expect(result.status).toBe('stopped');
    expect(result.stillRunning).toBe(false);
    expect(result.text).toBe('Process died (agent exited)');
  });

  it('includes live progress while the turn is still running', async () => {
    const { writeTurnLive } = await import('../store/turn-live.js');
    const thread = seed({ status: 'running' });
    writeTurnLive(thread.id, {
      updatedAt: '2026-08-20T21:00:00.000Z',
      summary: 'Read foo.ts (3 tools)',
      lastTool: 'Read foo.ts',
      toolCount: 3,
    });
    const result = new Orchestrator().getTurnResult(thread.id);
    expect(result.stillRunning).toBe(true);
    expect(result.progress).toBe('Read foo.ts (3 tools)');
    expect(result.lastActivityAt).toBe('2026-08-20T21:00:00.000Z');
  });

  it('explains queued threads that have not started yet', () => {
    const thread = seed({ status: 'queued', queue: ['review this pr'] });
    const result = new Orchestrator().getTurnResult(thread.id);
    expect(result.stillRunning).toBe(true);
    expect(result.status).toBe('queued');
    expect(result.progress).toBe('Queued — waiting for a concurrency slot');
  });

  it('does not treat leftover running status as live after the agent died', () => {
    const thread = seed({
      status: 'running',
      agentText: 'Agent is running. Waiting for gate to pass.',
    });
    stampUpdatedAt(thread.id, '2020-01-01T00:00:00.000Z');
    const result = new Orchestrator().getTurnResult(thread.id);
    expect(result.stillRunning).toBe(false);
    expect(result.status).toBe('stopped');
    expect(result.progress).toBeNull();
    expect(result.text).not.toMatch(/gate to pass/i);
  });

  it('does not treat empty queued as waiting for a slot', () => {
    const thread = seed({ status: 'queued' });
    const result = new Orchestrator().getTurnResult(thread.id);
    expect(result.stillRunning).toBe(false);
    expect(result.status).toBe('idle');
    expect(result.progress).toBeNull();
  });

  it('hides Cursor gate chatter from progress while a turn is still live', async () => {
    const { writeTurnLive } = await import('../store/turn-live.js');
    const thread = seed({ status: 'running' });
    writeTurnLive(thread.id, {
      updatedAt: new Date().toISOString(),
      summary: 'Agent is running. Waiting for gate to pass.',
      toolCount: 0,
    });
    const result = new Orchestrator().getTurnResult(thread.id);
    expect(result.stillRunning).toBe(true);
    expect(result.progress).toBeNull();
  });

  it('includes last-turn usage and costUsd when present', () => {
    const worktreePath = join(dataDir, 'wt-usage');
    mkdirSync(worktreePath, { recursive: true });
    const thread = createEmptyThread({
      title: 'Spend',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/spend',
      worktreePath,
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      status: 'idle',
    });
    thread.messages.push(
      {
        role: 'agent',
        text: 'first',
        ts: new Date().toISOString(),
        usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.01 },
      },
      {
        role: 'agent',
        text: 'second',
        ts: new Date().toISOString(),
        usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.04 },
      },
    );
    writeThread(thread);

    const orch = new Orchestrator();
    const turn = orch.getTurnResult(thread.id);
    expect(turn.usage).toEqual({ inputTokens: 100, outputTokens: 20, costUsd: 0.04 });

    const spend = orch.getThreadUsage(thread.id);
    expect(spend.lastTurnUsage).toEqual({ inputTokens: 100, outputTokens: 20, costUsd: 0.04 });
    expect(spend.usage).toEqual({
      inputTokens: 110,
      outputTokens: 22,
      costUsd: 0.05,
    });
  });
});
