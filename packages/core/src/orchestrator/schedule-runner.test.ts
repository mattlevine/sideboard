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

describe('scheduleOptionsAfterRefusedAgentSwitch', () => {
  it('keeps effort and plan but drops the other agent’s model', async () => {
    const { scheduleOptionsAfterRefusedAgentSwitch } = await import('./schedule-runner.js');
    expect(
      scheduleOptionsAfterRefusedAgentSwitch({
        agent: 'cursor',
        model: 'grok',
        effort: 'max',
        fast: true,
        planMode: true,
        autonomy: 'full',
      }),
    ).toEqual({
      effort: 'max',
      fast: true,
      planMode: true,
      autonomy: 'full',
    });
    expect(
      scheduleOptionsAfterRefusedAgentSwitch({
        agent: 'claude',
        model: null,
        effort: 'high',
      }),
    ).toEqual({ effort: 'high' });
  });
});

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
    const ephemeral: string[] = [];
    const thread = orchThread({ id: 'new-orch' });
    runner.setScheduleFireHooks({
      findThread: () => null,
      send: async () => thread,
      startOrchestration: async ({ goal, ephemeralAutomationId, ephemeralTitle }) => {
        created.push(goal);
        ephemeral.push(`${ephemeralAutomationId ?? ''}:${ephemeralTitle ?? ''}`);
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
    expect(ephemeral).toEqual([`${schedule.id}:Triage Linear`]);
    expect(after.lastThreadId).toBe('new-orch');
    expect(after.enabled).toBe(true);
  });

  it('leaves a fresh morning chat open when archiveChat is false', async () => {
    const { store, runner } = await load();
    const thread = orchThread({ id: 'morning' });
    let ephemeral: string | undefined = 'unset';
    let title: string | undefined;
    runner.setScheduleFireHooks({
      findThread: () => null,
      send: async () => thread,
      startOrchestration: async (opts) => {
        ephemeral = opts.ephemeralAutomationId;
        title = opts.ephemeralTitle;
        return thread;
      },
    });
    const schedule = store.createSchedule({
      name: 'Start my day',
      prompt: 'Brief me before I get in',
      when: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '07:30', tz: 'UTC' },
      archiveChat: false,
      createdBy: 'ui',
    });
    const after = await runner.fireSchedule(schedule.id);
    expect(ephemeral).toBeUndefined();
    expect(title).toBe('Start my day');
    expect(after.lastThreadId).toBe('morning');
    expect(after.enabled).toBe(true);
    expect(store.getSchedule(schedule.id)?.threadId).toBeNull();
    expect(store.getSchedule(schedule.id)?.archiveChat).toBe(false);
  });

  it('opens a new Global chat when the target is missing', async () => {
    const { store, runner } = await load();
    const sent: string[] = [];
    const created = orchThread({ id: 'fallback-orch' });
    let ephemeral: string | undefined = 'unset';
    runner.setScheduleFireHooks({
      findThread: () => null,
      send: async (id, prompt) => {
        sent.push(`${id}:${prompt}`);
        return created;
      },
      startOrchestration: async (opts) => {
        ephemeral = opts.ephemeralAutomationId;
        return created;
      },
    });
    const schedule = store.createSchedule({
      prompt: 'Ping',
      when: { kind: 'every', every: '15m' },
      threadId: 'missing-thread',
      createdBy: 'cli',
    });
    const after = await runner.fireSchedule(schedule.id);
    expect(sent).toHaveLength(0);
    expect(after.lastThreadId).toBe('fallback-orch');
    expect(after.lastError).toBeNull();
    expect(after.enabled).toBe(true);
    expect(store.getSchedule(schedule.id)?.threadId).toBe('fallback-orch');
    expect(ephemeral).toBeUndefined();
  });

  it('opens a new Global chat when the target is archived', async () => {
    const { store, runner } = await load();
    const archived = orchThread({ id: 'old-orch', status: 'archived' });
    const created = orchThread({ id: 'new-orch' });
    let sent = 0;
    runner.setScheduleFireHooks({
      findThread: () => archived,
      send: async () => {
        sent += 1;
        return archived;
      },
      startOrchestration: async () => created,
    });
    const schedule = store.createSchedule({
      prompt: 'Retry',
      when: { kind: 'once', at: '2099-01-01T00:00:00.000Z' },
      threadId: archived.id,
      createdBy: 'ui',
    });
    const after = await runner.fireSchedule(schedule.id);
    expect(sent).toBe(0);
    expect(after.lastThreadId).toBe('new-orch');
    expect(after.lastError).toBeNull();
    expect(after.enabled).toBe(false);
  });

  it('sends to an existing worktree chat', async () => {
    const { store, runner } = await load();
    const sent: string[] = [];
    const worktree = orchThread({
      id: 'wt-1',
      sourceType: 'branch',
      sourceRef: 'main',
      repoPath: '/tmp/repo',
      worktreePath: '/tmp/repo/lens',
    });
    runner.setScheduleFireHooks({
      findThread: () => worktree,
      send: async (id, prompt) => {
        sent.push(`${id}:${prompt}`);
        return worktree;
      },
      startOrchestration: async () => orchThread(),
    });
    const schedule = store.createSchedule({
      name: 'Follow-up',
      prompt: 'Retry the flaky test',
      when: { kind: 'once', at: '2099-01-01T00:00:00.000Z' },
      threadId: worktree.id,
      createdBy: 'mcp',
    });
    const after = await runner.fireSchedule(schedule.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('wt-1:');
    expect(sent[0]).toContain('Retry the flaky test');
    expect(after.lastThreadId).toBe('wt-1');
    expect(after.lastError).toBeNull();
  });

  it('passes composer files and agent settings into a new chat', async () => {
    const { store, runner } = await load();
    const thread = orchThread({ id: 'new-orch' });
    let captured: {
      agent?: string;
      model?: string | null;
      effort?: string;
      fast?: boolean;
      planMode?: boolean;
      autonomy?: string;
      attachments?: Thread['attachments'];
    } = {};
    runner.setScheduleFireHooks({
      findThread: () => null,
      send: async () => thread,
      startOrchestration: async (opts) => {
        captured = opts;
        return thread;
      },
    });
    const file = {
      id: 'file-1',
      name: 'note.txt',
      kind: 'file' as const,
      content: 'hello',
    };
    const schedule = store.createSchedule({
      prompt: 'Look at this',
      when: { kind: 'every', every: '1h' },
      agent: 'cursor',
      model: 'grok',
      effort: 'max',
      fast: true,
      planMode: true,
      autonomy: 'full',
      attachments: [file],
      createdBy: 'ui',
    });
    expect(store.getSchedule(schedule.id)?.attachments).toEqual([file]);
    await runner.fireSchedule(schedule.id);
    expect(captured.agent).toBe('cursor');
    expect(captured.model).toBe('grok');
    expect(captured.effort).toBe('max');
    expect(captured.fast).toBe(true);
    expect(captured.planMode).toBe(true);
    expect(captured.autonomy).toBe('full');
    expect(captured.attachments).toEqual([file]);
  });

  it('sends composer files and options to an existing chat', async () => {
    const { store, runner } = await load();
    const worktree = orchThread({ id: 'wt-1' });
    let sentOpts: { attachments?: Thread['attachments']; options?: { agent?: string; effort?: string; planMode?: boolean } } | undefined;
    runner.setScheduleFireHooks({
      findThread: () => worktree,
      send: async (_id, _prompt, opts) => {
        sentOpts = opts;
        return worktree;
      },
      startOrchestration: async () => orchThread(),
    });
    const file = {
      id: 'file-2',
      name: 'shot.png',
      kind: 'file' as const,
      content: 'Image attached: shot.png',
      previewDataUrl: 'data:image/png;base64,aGk=',
    };
    const schedule = store.createSchedule({
      prompt: 'Check the screenshot',
      when: { kind: 'once', at: '2099-01-01T00:00:00.000Z' },
      threadId: worktree.id,
      agent: 'claude',
      model: null,
      effort: 'high',
      planMode: true,
      attachments: [file],
      createdBy: 'ui',
    });
    await runner.fireSchedule(schedule.id);
    expect(sentOpts?.attachments).toEqual([file]);
    expect(sentOpts?.options).toMatchObject({
      agent: 'claude',
      model: null,
      effort: 'high',
      planMode: true,
    });
  });
});
