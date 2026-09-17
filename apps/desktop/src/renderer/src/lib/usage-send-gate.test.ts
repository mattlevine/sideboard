import { describe, expect, it } from 'vitest';
import { createUsageSendGate } from './usage-send-gate';

describe('createUsageSendGate', () => {
  it('blocks a second send until end()', () => {
    const gate = createUsageSendGate();
    expect(gate.tryBegin()).toBe(true);
    expect(gate.tryBegin()).toBe(false);
    gate.end();
    expect(gate.tryBegin()).toBe(true);
  });

  it('reuses one in-flight confirm so the first await settles', async () => {
    const gate = createUsageSendGate();
    let starts = 0;
    let resolveConfirm!: (ok: boolean) => void;
    const run = () => {
      starts += 1;
      return new Promise<boolean>((resolve) => {
        resolveConfirm = resolve;
      });
    };
    const first = gate.shareConfirm(run);
    const second = gate.shareConfirm(run);
    expect(starts).toBe(1);
    resolveConfirm(true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    const third = gate.shareConfirm(async () => false);
    await expect(third).resolves.toBe(false);
    expect(starts).toBe(1);
  });
});
