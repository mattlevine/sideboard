import { describe, expect, it } from 'vitest';
import { reuseJoinedUserBubble } from './enqueue-thread-send.js';

describe('reuseJoinedUserBubble', () => {
  it('reuses a rewritten user prompt above a partial agent reply', () => {
    const reused = new Set(['t1']);
    expect(
      reuseJoinedUserBubble(
        reused,
        't1',
        [
          { role: 'user', text: 'Work on issue A\nAnd B', ts: '1' },
          { role: 'agent', text: 'partial', ts: '2' },
        ],
        'Work on issue A\nAnd B',
      ),
    ).toBe(true);
    expect(reused.has('t1')).toBe(false);
  });

  it('appends when the latest user message is a different prompt', () => {
    const reused = new Set(['t1']);
    expect(
      reuseJoinedUserBubble(
        reused,
        't1',
        [
          { role: 'user', text: 'Work on issue A', ts: '1' },
          { role: 'agent', text: 'partial', ts: '2' },
        ],
        'Work on issue A\nAnd B',
      ),
    ).toBe(false);
  });
});
