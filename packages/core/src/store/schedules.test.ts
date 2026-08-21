import { mkdtempSync, rmSync } from 'node:fs';
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

  it('resolves self thread ids from the orchestrator env', async () => {
    const { resolveScheduleThreadId } = await load();
    expect(resolveScheduleThreadId(undefined)).toBeNull();
    expect(resolveScheduleThreadId('')).toBeNull();
    expect(resolveScheduleThreadId('abc-123')).toBe('abc-123');
    expect(
      resolveScheduleThreadId('self', { SIDEBOARD_ORCHESTRATOR_THREAD_ID: ' orch-1 ' }),
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
});
