import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('caffeinate hold', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;

  afterEach(() => {
    if (prevData == null) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    vi.resetModules();
  });

  async function load() {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-caffeinate-'));
    return import('./caffeinate-hold.js');
  }

  it('starts a detached caffeinate and stops it', async () => {
    const mod = await load();
    const spawned: number[] = [];
    const killed: number[] = [];
    let alive = new Set<number>();
    let nextPid = 4242;
    mod.setCaffeinateHoldHooks({
      platform: 'darwin',
      spawn: () => {
        const pid = nextPid++;
        spawned.push(pid);
        alive.add(pid);
        return {
          pid,
          unref: () => undefined,
          kill: () => {
            alive.delete(pid);
          },
        } as ReturnType<typeof import('node:child_process').spawn>;
      },
      processAlive: (pid) => alive.has(pid),
      kill: (pid) => {
        killed.push(pid);
        alive.delete(pid);
      },
    });

    const on = mod.setCaffeinateHold(true);
    expect(on).toMatchObject({ held: true, running: true, platform: 'darwin' });
    expect(spawned).toEqual([4242]);
    expect(mod.getCaffeinateHold().pid).toBe(4242);

    const still = mod.setCaffeinateHold(true);
    expect(still.pid).toBe(4242);
    expect(spawned).toHaveLength(1);

    const off = mod.setCaffeinateHold(false);
    expect(off).toEqual({
      held: false,
      pid: null,
      running: false,
      platform: 'darwin',
      threadIds: [],
    });
    expect(killed).toEqual([4242]);
    expect(mod.getCaffeinateHold().held).toBe(false);
  });

  it('does not spawn on non-darwin', async () => {
    const mod = await load();
    const spawned: unknown[] = [];
    mod.setCaffeinateHoldHooks({
      platform: 'linux',
      spawn: () => {
        spawned.push(true);
        return { pid: 1, unref: () => undefined } as ReturnType<
          typeof import('node:child_process').spawn
        >;
      },
    });
    expect(mod.setCaffeinateHold(true)).toMatchObject({
      held: false,
      running: false,
      platform: 'linux',
    });
    expect(spawned).toHaveLength(0);
  });

  it('keeps caffeinate until the last holding orchestration chat releases', async () => {
    const mod = await load();
    const killed: number[] = [];
    let alive = new Set<number>();
    mod.setCaffeinateHoldHooks({
      platform: 'darwin',
      spawn: () => {
        alive.add(7);
        return {
          pid: 7,
          unref: () => undefined,
          kill: () => {
            alive.delete(7);
          },
        } as ReturnType<typeof import('node:child_process').spawn>;
      },
      processAlive: (pid) => alive.has(pid),
      kill: (pid) => {
        killed.push(pid);
        alive.delete(pid);
      },
    });

    mod.setCaffeinateHold(true, { threadId: 'orch-a' });
    mod.setCaffeinateHold(true, { threadId: 'orch-b' });
    expect(mod.getCaffeinateHold().threadIds).toEqual(['orch-a', 'orch-b']);

    const afterA = mod.releaseCaffeinateHoldForThread('orch-a');
    expect(afterA.held).toBe(true);
    expect(afterA.threadIds).toEqual(['orch-b']);
    expect(killed).toEqual([]);

    const afterOther = mod.releaseCaffeinateHoldForThread('unrelated');
    expect(afterOther.held).toBe(true);
    expect(killed).toEqual([]);

    const afterB = mod.releaseCaffeinateHoldForThread('orch-b');
    expect(afterB.held).toBe(false);
    expect(killed).toEqual([7]);
  });

  it('releases a legacy hold (no thread ids) when that chat closes', async () => {
    const mod = await load();
    const killed: number[] = [];
    let alive = new Set<number>([9]);
    mod.setCaffeinateHoldHooks({
      platform: 'darwin',
      spawn: () => {
        alive.add(9);
        return {
          pid: 9,
          unref: () => undefined,
          kill: () => {
            alive.delete(9);
          },
        } as ReturnType<typeof import('node:child_process').spawn>;
      },
      processAlive: (pid) => alive.has(pid),
      kill: (pid) => {
        killed.push(pid);
        alive.delete(pid);
      },
    });
    mod.setCaffeinateHold(true);
    expect(mod.getCaffeinateHold().threadIds).toEqual([]);
    expect(mod.releaseCaffeinateHoldForThread('orch-legacy').held).toBe(false);
    expect(killed).toEqual([9]);
  });

  it('reports which orchestration chat is holding caffeinate', async () => {
    const mod = await load();
    const idle = {
      held: false,
      pid: null,
      running: false,
      platform: 'darwin' as const,
      threadIds: [],
    };
    expect(mod.isThreadCaffeinated('orch-a', idle)).toBe(false);
    expect(
      mod.isThreadCaffeinated('orch-a', { ...idle, held: true, pid: 1, running: true }),
    ).toBe(true);
    expect(
      mod.isThreadCaffeinated('orch-a', {
        ...idle,
        held: true,
        pid: 1,
        running: true,
        threadIds: ['orch-b'],
      }),
    ).toBe(false);
    expect(
      mod.isThreadCaffeinated('orch-b', {
        ...idle,
        held: true,
        pid: 1,
        running: true,
        threadIds: ['orch-b'],
      }),
    ).toBe(true);
  });
});
