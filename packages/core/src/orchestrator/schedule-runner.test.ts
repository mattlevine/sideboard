import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import type { Thread } from '../types/thread.js';

function orchThread(over: Partial<Thread> = {}): Thread {
  return {
    id: 'orch-1',
    title: 'Arsenal',
    sourceType: 'orchestration',
    sourceRef: 'Ship it',
    branchName: 'global',
    worktreePath: '/tmp/global',
    repoPath: GLOBAL_WORKSPACE_ID,
    agent: 'claude',
    model: null,
    effort: 'high',
    fast: false,
    planMode: false,
    sessionId: null,
    autonomy: 'default',
    sourceIsFork: false,
    status: 'idle',
    queue: [],
    parentThreadId: null,
    devPort: null,
    activeRuns: [],
    prUrl: null,
    prTitle: null,
    prState: null,
    stackId: null,
    stackLayer: null,
    userSetTitle: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    attachments: [],
    ...over,
  } as Thread;
}

describe('schedule runner', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-sched-run-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
    process.env.SIDEBOARD_SECRET_VAULT = 'plain';
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    delete process.env.SIDEBOARD_SECRET_VAULT;
    rmSync(dataDir, { recursive: true, force: true });
    vi.resetModules();
  });

  async function load() {
    const store = await import('../store/schedules.js');
    const runner = await import('./schedule-runner.js');
    runner.clearScheduleTimers();
    return { store, runner };
  }

  it('sends to an existing orchestration chat', async () => {
    const { store, runner } = await load();
    const sent: string[] = [];
    const created: string[] = [];
    const thread = orchThread();
    runner.setScheduleFireHooks({
      findThread: () => thread,
      send: async (id, prompt) => {
        sent.push(`${id}:${prompt}`);
        return thread;
      },
      startOrchestration: async ({ goal }) => {
        created.push(goal);
        return thread;
      },
    });
    const schedule = store.createSchedule({
      name: 'Standup',
      prompt: 'Summarize open PRs',
      when: { kind: 'once', at: '2099-01-01T00:00:00.000Z' },
      threadId: thread.id,
      createdBy: 'ui',
    });
    const after = await runner.fireSchedule(schedule.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('[Scheduled: Standup]');
    expect(sent[0]).toContain('Summarize open PRs');
    expect(created).toHaveLength(0);
    expect(after.enabled).toBe(false);
    expect(after.lastThreadId).toBe(thread.id);
    expect(after.lastError).toBeNull();
  });

  it('creates a new Global chat when threadId is omitted', async () => {
    const { store, runner } = await load();
    const created: string[] = [];
    const thread = orchThread({ id: 'new-orch' });
    runner.setScheduleFireHooks({
      findThread: () => null,
      send: async () => thread,
      startOrchestration: async ({ goal }) => {
        created.push(goal);
        return thread;
      },
    });
    const schedule = store.createSchedule({
      prompt: 'Triage Linear',
      when: { kind: 'every', every: '1h' },
      createdBy: 'mcp',
    });
    const after = await runner.fireSchedule(schedule.id);
    expect(created).toHaveLength(1);
    expect(created[0]).toContain('[Scheduled: Triage Linear]');
    expect(after.lastThreadId).toBe('new-orch');
    expect(after.enabled).toBe(true);
  });

  it('skips a missing target thread and records lastError', async () => {
    const { store, runner } = await load();
    let started = 0;
    runner.setScheduleFireHooks({
      findThread: () => null,
      send: async () => orchThread(),
      startOrchestration: async () => {
        started += 1;
        return orchThread();
      },
    });
    const schedule = store.createSchedule({
      prompt: 'Ping',
      when: { kind: 'every', every: '15m' },
      threadId: 'missing-thread',
      createdBy: 'cli',
    });
    const after = await runner.fireSchedule(schedule.id);
    expect(started).toBe(0);
    expect(after.lastError).toMatch(/not found/);
    expect(after.enabled).toBe(true);
  });
});
