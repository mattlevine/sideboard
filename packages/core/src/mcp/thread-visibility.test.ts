import { describe, expect, it } from 'vitest';
import type { Thread } from '../types/thread.js';
import { childThreadRefs, lastMessagePreview } from './thread-visibility.js';

describe('lastMessagePreview', () => {
  it('returns the last non-empty message, flattened', () => {
    expect(
      lastMessagePreview([
        { role: 'user', text: 'do the thing', ts: '1' },
        { role: 'agent', text: '  Done.\nPushed a draft.  ', ts: '2' },
      ]),
    ).toBe('Done. Pushed a draft.');
  });

  it('skips Cursor gate chatter so coordinators do not parrot it', () => {
    expect(
      lastMessagePreview([
        { role: 'agent', text: 'Pushed a draft.', ts: '1' },
        { role: 'agent', text: 'Agent is running. Waiting for gate to pass.', ts: '2' },
      ]),
    ).toBe('Pushed a draft.');
  });

  it('truncates long text', () => {
    const preview = lastMessagePreview(
      [{ role: 'agent', text: 'x'.repeat(200), ts: '1' }],
      40,
    );
    expect(preview).toBe(`${'x'.repeat(40)}…`);
  });
});

describe('childThreadRefs', () => {
  it('lists children of an orchestration chat with lastText', () => {
    const children = childThreadRefs('orch-1', [
      {
        id: 'child-a',
        title: 'Fix meter',
        status: 'idle',
        agent: 'cursor',
        parentThreadId: 'orch-1',
        messages: [{ role: 'agent', text: 'Ring now shows occupancy', ts: '1' }],
      },
      {
        id: 'other',
        title: 'Unrelated',
        status: 'running',
        agent: 'claude',
        parentThreadId: 'orch-2',
        messages: [],
      },
    ] as Thread[]);
    expect(children).toEqual([
      {
        id: 'child-a',
        title: 'Fix meter',
        status: 'idle',
        agent: 'cursor',
        lastText: 'Ring now shows occupancy',
      },
    ]);
  });
});
