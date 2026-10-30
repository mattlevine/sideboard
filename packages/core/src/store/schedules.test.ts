import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('schedules store', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-schedules-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function load() {
    return import('./schedules.js');
  }

  it('parses duration strings', async () => {
    const { parseDurationMs } = await load();
    expect(parseDurationMs('15m')).toBe(15 * 60_000);
    expect(parseDurationMs('1h')).toBe(3_600_000);
    expect(parseDurationMs('6h')).toBe(6 * 3_600_000);
    expect(parseDurationMs('1d')).toBe(86_400_000);
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('nope')).toBeNull();
    expect(parseDurationMs('0m')).toBeNull();
  });

  it('computes nextRunAt for once / every / cron', async () => {
    const { computeNextRunAt } = await load();
    const from = new Date('2026-08-21T17:00:00.000Z');
    expect(computeNextRunAt({ kind: 'once', at: '2026-08-22T09:00:00.000Z' }).toISOString()).toBe(
      '2026-08-22T09:00:00.000Z',
    );
    expect(computeNextRunAt({ kind: 'every', every: '1h' }, from).toISOString()).toBe(
      '2026-08-21T18:00:00.000Z',
    );
    const cronNext = computeNextRunAt(
      { kind: 'cron', expr: '0 9 * * *', tz: 'UTC' },
      from,
    );
    expect(cronNext.toISOString()).toBe('2026-08-22T09:00:00.000Z');
  });

  it('computes a clock time on selected days', async () => {
    const { computeNextRunAt, formatScheduleWhen, parseWeeklyDays } = await load();
    const fridayEvening = new Date('2026-08-21T17:00:00.000Z');
    expect(parseWeeklyDays('weekdays')).toEqual([1, 2, 3, 4, 5]);
    expect(parseWeeklyDays('Mon, Wed, Fri')).toEqual([1, 3, 5]);
    expect(parseWeeklyDays('mon-fri')).toEqual([1, 2, 3, 4, 5]);
    expect(parseWeeklyDays('daily')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(() => parseWeeklyDays('funday')).toThrow(/Unknown day/);

    const weekdays = computeNextRunAt(
      { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00', tz: 'UTC' },
      fridayEvening,
    );
    expect(weekdays.toISOString()).toBe('2026-08-24T09:00:00.000Z');

    const laterThatMorning = computeNextRunAt(
      { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00', tz: 'UTC' },
      new Date('2026-08-24T07:00:00.000Z'),
    );
    expect(laterThatMorning.toISOString()).toBe('2026-08-24T09:00:00.000Z');

    expect(
      formatScheduleWhen({ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '07:30', tz: 'UTC' }),
    ).toBe('weekdays at 07:30 (UTC)');
    expect(
      formatScheduleWhen({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '08:00' }),
    ).toBe('daily at 08:00');
  });

  it('resolves self thread ids from orchestration or worktree env', async () => {
    const { resolveScheduleThreadId } = await load();
    expect(resolveScheduleThreadId(undefined)).toBeNull();
    expect(resolveScheduleThreadId('')).toBeNull();
    expect(resolveScheduleThreadId('abc-123')).toBe('abc-123');
    expect(
      resolveScheduleThreadId('self', { SIDEBOARD_ORCHESTRATOR_THREAD_ID: ' orch-1 ' }),
    ).toBe('orch-1');
    expect(
      resolveScheduleThreadId('self', { SIDEBOARD_THREAD_ID: ' wt-1 ' }),
    ).toBe('wt-1');
    expect(
      resolveScheduleThreadId('self', {
        SIDEBOARD_ORCHESTRATOR_THREAD_ID: 'orch-1',
        SIDEBOARD_THREAD_ID: 'wt-1',
      }),
    ).toBe('orch-1');
    expect(resolveScheduleThreadId('self', {})).toBeNull();
  });

  it('creates, lists, updates, and deletes a schedule', async () => {
    const {
      createSchedule,
      listSchedules,
      getSchedule,
      updateSchedule,
      deleteSchedule,
    } = await load();
    const created = createSchedule({
      prompt: 'Check CI',
      when: { kind: 'every', every: '1h' },
      createdBy: 'cli',
    });
    expect(created.name).toBe('Check CI');
    expect(created.enabled).toBe(true);
    expect(created.threadId).toBeNull();
    expect(created.archiveChat).toBe(true);
    expect(listSchedules()).toHaveLength(1);
    expect(getSchedule(created.id.slice(0, 8))?.id).toBe(created.id);

    const updated = updateSchedule(created.id, { enabled: false, name: 'Nightly CI' });
    expect(updated.enabled).toBe(false);
    expect(updated.name).toBe('Nightly CI');

    deleteSchedule(created.id);
    expect(listSchedules()).toHaveLength(0);
  });

  it('disables one-shots and advances recurring after a run', async () => {
    const { createSchedule, recordScheduleRun } = await load();
    const once = createSchedule({
      prompt: 'Once',
      when: { kind: 'once', at: '2099-01-01T00:00:00.000Z' },
      createdBy: 'ui',
    });
    const afterOnce = recordScheduleRun(once.id, {
      lastThreadId: 't1',
      firedAt: new Date('2026-08-21T12:00:00.000Z'),
    });
    expect(afterOnce.enabled).toBe(false);
    expect(afterOnce.lastThreadId).toBe('t1');

    const every = createSchedule({
      prompt: 'Hourly',
      when: { kind: 'every', every: '1h' },
      createdBy: 'mcp',
    });
    const afterEvery = recordScheduleRun(every.id, {
      lastError: 'Thread not found',
      firedAt: new Date('2026-08-21T12:00:00.000Z'),
    });
    expect(afterEvery.enabled).toBe(true);
    expect(afterEvery.lastError).toBe('Thread not found');
    expect(afterEvery.nextRunAt).toBe('2026-08-21T13:00:00.000Z');
  });

  it('reports whether any schedule is enabled', async () => {
    const { createSchedule, updateSchedule, hasEnabledSchedules } = await load();
    expect(hasEnabledSchedules()).toBe(false);
    const row = createSchedule({
      prompt: 'Ping',
      when: { kind: 'every', every: '1h' },
      createdBy: 'ui',
    });
    expect(hasEnabledSchedules()).toBe(true);
    updateSchedule(row.id, { enabled: false });
    expect(hasEnabledSchedules()).toBe(false);
  });

  it('turns on caffeinate-while-schedules for an enabled future job', async () => {
    const { createSchedule, updateSchedule, scheduleNeedsCaffeinate } = await load();
    const settings = await import('./app-settings.js');
    expect(settings.caffeinateWhileSchedulesEnabled()).toBe(false);
    const row = createSchedule({
      prompt: 'Later',
      when: { kind: 'once', at: '2099-01-01T00:00:00.000Z' },
      createdBy: 'mcp',
    });
    expect(scheduleNeedsCaffeinate(row)).toBe(true);
    expect(settings.caffeinateWhileSchedulesEnabled()).toBe(true);

    settings.updateAdvancedSettings({ caffeinateWhileSchedules: false });
    expect(settings.caffeinateWhileSchedulesEnabled()).toBe(false);
    const disabled = createSchedule({
      prompt: 'Off',
      when: { kind: 'every', every: '1h' },
      enabled: false,
      createdBy: 'ui',
    });
    expect(scheduleNeedsCaffeinate(disabled)).toBe(false);
    expect(settings.caffeinateWhileSchedulesEnabled()).toBe(false);

    updateSchedule(disabled.id, { enabled: true });
    expect(settings.caffeinateWhileSchedulesEnabled()).toBe(true);
  });

  it('keeps a morning chat open and advances to the next weekday', async () => {
    const { createSchedule, getSchedule, recordScheduleRun, schedulesPath, updateSchedule } =
      await load();
    writeFileSync(
      schedulesPath(),
      `${JSON.stringify([
        {
          id: 'legacy-job',
          name: 'Legacy',
          prompt: 'Old job',
          enabled: true,
          when: { kind: 'every', every: '1h' },
          nextRunAt: '2099-01-01T00:00:00.000Z',
          createdBy: 'ui',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ])}\n`,
    );
    expect(getSchedule('legacy-job')?.archiveChat).toBe(true);

    const row = createSchedule({
      name: 'Start my day',
      prompt: 'Brief me',
      when: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '07:30:00', tz: 'UTC' },
      archiveChat: false,
      createdBy: 'ui',
    });
    expect(row.archiveChat).toBe(false);
    expect(row.when).toEqual({
      kind: 'weekly',
      days: [1, 2, 3, 4, 5],
      time: '07:30',
      tz: 'UTC',
    });
    const after = recordScheduleRun(row.id, {
      lastThreadId: 'morning',
      firedAt: new Date('2026-08-21T17:00:00.000Z'),
    });
    expect(after.enabled).toBe(true);
    expect(after.archiveChat).toBe(false);
    expect(after.nextRunAt).toBe('2026-08-24T07:30:00.000Z');

    const closed = updateSchedule(row.id, { archiveChat: true });
    expect(closed.archiveChat).toBe(true);
  });

  it('removes chat-bound automations when that chat is archived or deleted', async () => {
    const { createSchedule, listSchedules } = await load();
    const threads = await import('./thread-store.js');
    const chat = threads.createEmptyThread({
      title: 'watch',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/watch',
      worktreePath: '/tmp/watch',
      repoPath: '/tmp/repo',
      agent: 'claude',
    });
    const other = threads.createEmptyThread({
      title: 'other',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/other',
      worktreePath: '/tmp/other',
      repoPath: '/tmp/repo',
      agent: 'claude',
    });
    threads.writeThread(chat);
    threads.writeThread(other);
    createSchedule({
      prompt: 'Keep checking CI',
      when: { kind: 'every', every: '1h' },
      threadId: chat.id,
      createdBy: 'mcp',
    });
    createSchedule({
      prompt: 'Morning brief',
      when: { kind: 'every', every: '1d' },
      createdBy: 'ui',
    });
    createSchedule({
      prompt: 'Other chat',
      when: { kind: 'every', every: '1h' },
      threadId: other.id,
      createdBy: 'mcp',
    });

    threads.setStatus(chat.id, 'archived');
    expect(listSchedules().map((row) => row.prompt).sort()).toEqual(['Morning brief', 'Other chat']);

    threads.deleteThreadRecord(other.id);
    expect(listSchedules().map((row) => row.prompt)).toEqual(['Morning brief']);
  });
});
