import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  askPhoneMcp,
  deliverPhoneMcpWaiter,
  nextPhoneMcpReqId,
} from '../../../../apps/mobile/phone-mcp-waiters.ts';

describe('phone MCP waiters', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives each in-flight request its own id', () => {
    const ids = new Set([nextPhoneMcpReqId(), nextPhoneMcpReqId(), nextPhoneMcpReqId()]);
    expect(ids.size).toBe(3);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(40);
  });

  it('does not let an older timeout drop the waiter that replaced it', async () => {
    vi.useFakeTimers();
    const first = askPhoneMcp(() => undefined, { reqId: 'same' }, 30);
    const second = askPhoneMcp(() => undefined, { reqId: 'same' }, 5_000);
    await vi.advanceTimersByTimeAsync(30);
    await expect(first).resolves.toBeNull();
    deliverPhoneMcpWaiter({ op: 'mcp-ui-call', reqId: 'same', result: { ok: true } });
    await expect(second).resolves.toMatchObject({ result: { ok: true } });
  });
});
