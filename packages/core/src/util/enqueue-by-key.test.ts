import { describe, expect, it } from 'vitest';
import { enqueueByKey } from './enqueue-by-key.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('enqueueByKey', () => {
  it('runs same-key tasks in order', async () => {
    const log: number[] = [];
    const first = enqueueByKey('same', async () => {
      await delay(30);
      log.push(1);
    });
    const second = enqueueByKey('same', async () => {
      log.push(2);
    });
    await Promise.all([first, second]);
    expect(log).toEqual([1, 2]);
  });

  it('runs different keys concurrently', async () => {
    let concurrent = 0;
    let max = 0;
    const run = (key: string) =>
      enqueueByKey(key, async () => {
        concurrent += 1;
        max = Math.max(max, concurrent);
        await delay(25);
        concurrent -= 1;
      });
    await Promise.all([run('a'), run('b')]);
    expect(max).toBe(2);
  });

  it('does not stall the chain when a task rejects', async () => {
    const failed = enqueueByKey('err', async () => {
      throw new Error('boom');
    });
    await expect(failed).rejects.toThrow('boom');
    let ran = false;
    await enqueueByKey('err', async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
