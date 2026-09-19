import { describe, expect, it } from 'vitest';
import { withTimeout } from './turn-trace.js';

describe('withTimeout', () => {
  it('resolves when the promise wins', async () => {
    await expect(withTimeout(Promise.resolve(7), 50, 'fast')).resolves.toBe(7);
  });

  it('rejects when the timer wins', async () => {
    await expect(
      withTimeout(new Promise(() => undefined), 20, 'stuck'),
    ).rejects.toThrow('stuck timed out after 20ms');
  });
});
