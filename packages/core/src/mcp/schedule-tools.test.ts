import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('whenFromUpdate', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-schedule-tools-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function load() {
    return import('./schedule-tools.js');
  }

  it('changes the clock time of a weekly job without resetting its days', async () => {
    const { whenFromUpdate } = await load();
    const { createSchedule } = await import('../store/schedules.js');
    const schedule = createSchedule({
      prompt: 'Start my day',
      when: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '07:30', tz: 'America/Los_Angeles' },
      createdBy: 'mcp',
    });
    expect(whenFromUpdate(schedule.id, { time: '08:15' })).toEqual({
      kind: 'weekly',
      time: '08:15',
      days: [1, 2, 3, 4, 5],
      tz: 'America/Los_Angeles',
    });
  });

  it('refuses to turn an interval job into a daily job when only time is passed', async () => {
    const { whenFromUpdate } = await load();
    const { createSchedule } = await import('../store/schedules.js');
    const schedule = createSchedule({
      prompt: 'Ping',
      when: { kind: 'every', every: '1h' },
      createdBy: 'mcp',
    });
    expect(() => whenFromUpdate(schedule.id, { time: '07:30' })).toThrow(/This job is every/);
    expect(() => whenFromUpdate(schedule.id, { days: 'weekdays' })).toThrow(/This job is every/);
  });

  it('switches to weekly when time and days are both passed', async () => {
    const { whenFromUpdate } = await load();
    const { createSchedule } = await import('../store/schedules.js');
    const schedule = createSchedule({
      prompt: 'Ping',
      when: { kind: 'cron', expr: '0 * * * *', tz: 'UTC' },
      createdBy: 'mcp',
    });
    expect(whenFromUpdate(schedule.id, { time: '07:30', days: 'weekdays' })).toEqual({
      kind: 'weekly',
      time: '07:30',
      days: [1, 2, 3, 4, 5],
      tz: 'UTC',
    });
  });
});
