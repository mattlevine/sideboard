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

  it('removes the automation when the target chat is missing', async () => {
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
    expect(after.lastError).toMatch(/archived or gone/);
    expect(after.enabled).toBe(false);
    expect(store.getSchedule(schedule.id)).toBeNull();
  });

  it('removes the automation when the target chat is archived', async () => {
    const { store, runner } = await load();
    const archived = orchThread({ id: 'old-orch', status: 'archived' });
    let started = 0;
    runner.setScheduleFireHooks({
      findThread: () => archived,
      send: async () => archived,
      startOrchestration: async () => {
        started += 1;
        return orchThread({ id: 'new-orch' });
      },
    });
    const schedule = store.createSchedule({
      prompt: 'Retry',
      when: { kind: 'once', at: '2099-01-01T00:00:00.000Z' },
      threadId: archived.id,
      createdBy: 'ui',
    });
    const after = await runner.fireSchedule(schedule.id);
    expect(started).toBe(0);
    expect(after.lastError).toMatch(/archived or gone/);
    expect(store.getSchedule(schedule.id)).toBeNull();
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

  it('opens a workspace and plans a newly assigned ticket, and does not merge', async () => {
    const { store, runner } = await load();
    const { expandCanonicalGitRequest } = await import('../git/agent-git-actions.js');
    const { updateAdvancedSettings } = await import('../store/app-settings.js');
    updateAdvancedSettings({ ticketAssignOpensWorkspace: true });
    const opened: Array<{ planMode: boolean; prompt: string; identifier: string; repoPath: string }> = [];
    let tickets = [
      {
        source: 'linear' as const,
        identifier: 'ENG-1',
        title: 'Login',
        url: 'https://linear.app/eng-1',
        projects: ['sideboard'],
      },
    ];
    runner.setTicketAssignHooks({
      list: async () => ({ tickets, failedPrefixes: [] }),
      workspaces: () => [{ name: 'sideboard', path: '/repo' }],
      findExisting: () => false,
      open: async (input) => {
        opened.push({
          planMode: input.planMode,
          prompt: input.prompt,
          identifier: input.identifier,
          repoPath: input.repoPath,
        });
        return { id: 'ws-1' };
      },
    });
    const schedule = store.createSchedule({
      name: 'Ticket assigned',
      prompt: 'Plan this ticket. Write the plan in this workspace. Do not implement it, do not open a pull request, and do not merge.',
      when: { kind: 'ticket-assigned' },
      planMode: true,
      createdBy: 'ui',
    });
    const baseline = await runner.fireSchedule(schedule.id);
    expect(opened).toHaveLength(0);
    expect(baseline.lastError).toBeNull();
    expect(runner.loadTicketAssignSnapshot().primed).toBe(true);
    expect(runner.loadTicketAssignSnapshot().keys).toContain('linear:eng-1');

    tickets = [
      ...tickets,
      {
        source: 'linear',
        identifier: 'ENG-2',
        title: 'Signup',
        url: 'https://linear.app/eng-2',
        projects: [],
      },
    ];
    const fired = await runner.fireSchedule(schedule.id);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.identifier).toBe('ENG-2');
    expect(opened[0]?.repoPath).toBe('/repo');
    expect(opened[0]?.planMode).toBe(true);
    expect(opened[0]?.prompt).toMatch(/Do not merge/);
    expect(opened[0]?.prompt).not.toBe('Merge PR.');
    expect(expandCanonicalGitRequest(opened[0]?.prompt ?? '')).toBe(opened[0]?.prompt);
    expect(fired.lastThreadId).toBe('ws-1');
    expect(fired.lastError).toBeNull();
  });

  it('does not open a workspace when the ticket-assign setting is off', async () => {
    const { store, runner } = await load();
    const opened: string[] = [];
    runner.setTicketAssignHooks({
      list: async () => ({
        tickets: [
          {
            source: 'github',
            identifier: '#4',
            title: 'Bug',
            url: 'https://github.com/acme/app/issues/4',
            projects: [],
            repoPath: '/repo',
          },
        ],
        failedPrefixes: [],
      }),
      workspaces: () => [{ name: 'app', path: '/repo' }],
      findExisting: () => false,
      open: async (input) => {
        opened.push(input.identifier);
        return { id: 'ws' };
      },
    });
    const schedule = store.createSchedule({
      prompt: 'Plan this ticket.',
      when: { kind: 'ticket-assigned' },
      planMode: true,
      createdBy: 'ui',
    });
    const after = await runner.fireSchedule(schedule.id);
    expect(opened).toHaveLength(0);
    expect(after.lastError).toMatch(/When a ticket is assigned to me is off/);
  });
});

describe('ticket assign latch', () => {
  it('keeps keys from a source that failed to list', async () => {
    const { planTicketAssignLatch, repoForAssignedTicket, ticketAssignKey } = await import(
      './schedule-runner.js'
    );
    const first = planTicketAssignLatch({
      prev: [],
      primed: false,
      observed: ['linear:eng-1'],
      failedPrefixes: [],
    });
    expect(first.fresh).toEqual([]);
    const second = planTicketAssignLatch({
      prev: first.next,
      primed: true,
      observed: ['github:/repo:#9'],
      failedPrefixes: ['linear:'],
    });
    expect(second.next).toContain('linear:eng-1');
    expect(second.fresh).toEqual(['github:/repo:#9']);
    expect(
      repoForAssignedTicket(
        {
          source: 'linear',
          identifier: 'ENG-9',
          title: 'Mail',
          url: '',
          projects: ['sideboard'],
        },
        [
          { name: 'other', path: '/other' },
          { name: 'sideboard', path: '/repo' },
        ],
      ),
    ).toBe('/repo');
    expect(
      ticketAssignKey({ source: 'github', identifier: '#9', repoPath: '/repo/' }),
    ).toBe('github:/repo:#9');
  });
});
