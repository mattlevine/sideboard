import { describe, expect, it } from 'vitest';
import { sendFollowUpInterrupts } from './enqueue-thread-send.js';

describe('sendFollowUpInterrupts', () => {
  it('lets join and queue wait behind a running turn', () => {
    expect(sendFollowUpInterrupts('join', true)).toBe(false);
    expect(sendFollowUpInterrupts('queue', true)).toBe(false);
    expect(sendFollowUpInterrupts('steer', true)).toBe(true);
    expect(sendFollowUpInterrupts('steer', false)).toBe(false);
  });
});
