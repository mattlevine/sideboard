import { describe, expect, it } from 'vitest';
import {
  dropRemovedFollowUp,
  extraPendingFollowUps,
  joinSteerPrompt,
  pendingSnapshotChanged,
  pendingTranscriptTexts,
  shouldDropStalePendingUser,
  shouldShowStreamingTurn,
  splitTurnQueue,
  unlandedFollowUps,
  steerJoinLanded,
  unlandedUserTexts,
} from './visible-follow-up-queue';

describe('splitTurnQueue', () => {
  it('treats a lone queued prompt as the current turn while idle', () => {
    expect(splitTurnQueue(['hello'], 'queued', false)).toEqual({
      currentTurnPrompt: 'hello',
      followUps: [],
    });
  });

  it('keeps extra items as follow-ups behind the current turn', () => {
    expect(splitTurnQueue(['now', 'later'], 'queued', false)).toEqual({
      currentTurnPrompt: 'now',
      followUps: ['later'],
    });
  });

  it('shows the full queue while a turn is in flight', () => {
    expect(splitTurnQueue(['follow-up'], 'running', true)).toEqual({
      currentTurnPrompt: null,
      followUps: ['follow-up'],
    });
  });

  it('shows parked items after stop (not draining as the current turn)', () => {
    expect(splitTurnQueue(['parked'], 'stopped', false)).toEqual({
      currentTurnPrompt: null,
      followUps: ['parked'],
    });
    expect(splitTurnQueue(['parked'], 'idle', false)).toEqual({
      currentTurnPrompt: null,
      followUps: ['parked'],
    });
  });
});

describe('joinSteerPrompt', () => {
  it('appends the next line onto the unanswered prompt', () => {
    expect(joinSteerPrompt('Work on issue A', 'And B')).toBe('Work on issue A\nAnd B');
  });
});

describe('unlandedUserTexts', () => {
  it('keeps every send that is not in the transcript yet', () => {
    expect(
      unlandedUserTexts(
        [
          { text: 'first', seen: 0 },
          { text: 'second', seen: 0 },
        ],
        [{ role: 'user', text: 'older' }],
      ),
    ).toEqual([
      { text: 'first', seen: 0 },
      { text: 'second', seen: 0 },
    ]);
  });

  it('drops a prompt once a new matching user message lands', () => {
    expect(
      unlandedUserTexts(
        [
          { text: 'first', seen: 0 },
          { text: 'second', seen: 0 },
        ],
        [
          { role: 'user', text: 'first' },
          { role: 'agent', text: 'ok' },
        ],
      ),
    ).toEqual([{ text: 'second', seen: 0 }]);
  });

  it('keeps a resend of text that is already in the transcript', () => {
    expect(
      unlandedUserTexts([{ text: 'same', seen: 1 }], [{ role: 'user', text: 'same' }]),
    ).toEqual([{ text: 'same', seen: 1 }]);
  });

  it('drops only the copies that have landed', () => {
    expect(
      unlandedUserTexts(
        [
          { text: 'same', seen: 1 },
          { text: 'same', seen: 1 },
        ],
        [
          { role: 'user', text: 'same' },
          { role: 'user', text: 'same' },
        ],
      ),
    ).toEqual([{ text: 'same', seen: 1 }]);
  });

  it('drops a joined steer bubble once both lines are stored before the reply', () => {
    const messages = [
      { role: 'user', text: 'do that' },
      { role: 'user', text: 'actually review the assumptions' },
      { role: 'agent', text: 'done' },
    ];
    const joined = 'do that\nactually review the assumptions';
    expect(steerJoinLanded(joined, messages)).toBe(true);
    expect(unlandedUserTexts([{ text: joined, seen: 0 }], messages)).toEqual([]);
    expect(
      pendingTranscriptTexts({
        optimistic: [{ text: joined, seen: 0 }],
        messages,
        currentTurnPrompt: null,
        pendingUser: joined,
        pendingInTranscript: true,
      }),
    ).toEqual([]);
    expect(
      shouldDropStalePendingUser({
        text: joined,
        messages,
        queue: [],
        status: 'idle',
        threadMoved: true,
      }),
    ).toBe(true);
  });

  it('keeps a joined steer bubble until every line is stored', () => {
    const messages = [{ role: 'user', text: 'do that' }];
    const joined = 'do that\nactually review the assumptions';
    expect(steerJoinLanded(joined, messages)).toBe(false);
    expect(unlandedUserTexts([{ text: joined, seen: 0 }], messages)).toEqual([
      { text: joined, seen: 0 },
    ]);
  });
});

describe('pendingTranscriptTexts', () => {
  it('keeps a plan answer that only set pendingUser', () => {
    expect(
      pendingTranscriptTexts({
        optimistic: [],
        messages: [{ role: 'agent', text: 'Which issue?' }],
        currentTurnPrompt: null,
        pendingUser: 'Issue A',
        pendingInTranscript: true,
      }),
    ).toEqual(['Issue A']);
  });

  it('does not duplicate a composer send already tracked as optimistic', () => {
    expect(
      pendingTranscriptTexts({
        optimistic: [{ text: 'Work on issue A\nAnd B', seen: 0 }],
        messages: [],
        currentTurnPrompt: null,
        pendingUser: 'Work on issue A\nAnd B',
        pendingInTranscript: true,
      }),
    ).toEqual(['Work on issue A\nAnd B']);
  });

  it('drops a joined steer bubble once the thread settles without that exact text', () => {
    expect(
      shouldDropStalePendingUser({
        text: 'Work on issue A\nAnd B',
        messages: [
          { role: 'user', text: 'Work on issue A' },
          { role: 'agent', text: 'partial' },
        ],
        queue: [],
        status: 'stopped',
        threadMoved: true,
      }),
    ).toBe(true);
  });

  it('keeps the bubble until the thread snapshot changes', () => {
    expect(
      shouldDropStalePendingUser({
        text: 'Work on issue A\nAnd B',
        messages: [{ role: 'user', text: 'Work on issue A' }],
        queue: [],
        status: 'idle',
        threadMoved: false,
      }),
    ).toBe(false);
  });

  it('keeps the queued head while that turn is waiting to start', () => {
    expect(
      shouldDropStalePendingUser({
        text: 'And B',
        messages: [],
        queue: ['And B'],
        status: 'queued',
        threadMoved: true,
      }),
    ).toBe(false);
  });

  it('releases a queued addition from the transcript once the turn has stopped', () => {
    expect(
      shouldDropStalePendingUser({
        text: 'And B',
        messages: [
          { role: 'user', text: 'Work on issue A' },
          { role: 'agent', text: 'partial' },
        ],
        queue: ['And B'],
        status: 'stopped',
        threadMoved: true,
      }),
    ).toBe(true);
  });

  it('keeps an in-flight send that has not reached the queue', () => {
    expect(
      shouldDropStalePendingUser({
        text: 'And B',
        messages: [{ role: 'user', text: 'Work on issue A' }],
        queue: [],
        status: 'idle',
        threadMoved: true,
      }),
    ).toBe(false);
    expect(
      shouldDropStalePendingUser({
        text: 'And B',
        messages: [],
        queue: [],
        status: 'queued',
        threadMoved: true,
      }),
    ).toBe(false);
  });

  it('ignores a refresh that clones the same transcript', () => {
    const messages = [{ role: 'user', text: 'Work on issue A' }];
    const queue = ['later'];
    expect(
      pendingSnapshotChanged(
        { messages, queue, status: 'idle' },
        { messages: [...messages], queue: [...queue], status: 'idle' },
      ),
    ).toBe(false);
    expect(
      pendingSnapshotChanged(
        { messages, queue, status: 'running' },
        { messages, queue, status: 'stopped' },
      ),
    ).toBe(true);
  });

  it('keeps a send that is still running', () => {
    expect(
      shouldDropStalePendingUser({
        text: 'And B',
        messages: [],
        queue: [],
        status: 'running',
        threadMoved: true,
      }),
    ).toBe(false);
  });

  it('keeps a resend until this copy is stored', () => {
    expect(
      shouldDropStalePendingUser({
        text: 'yes',
        messages: [{ role: 'user', text: 'yes' }],
        queue: ['yes'],
        status: 'queued',
        threadMoved: true,
        seen: 1,
      }),
    ).toBe(false);
  });

  it('drops a resend once another copy lands', () => {
    expect(
      shouldDropStalePendingUser({
        text: 'yes',
        messages: [
          { role: 'user', text: 'yes' },
          { role: 'user', text: 'yes' },
        ],
        queue: [],
        status: 'running',
        threadMoved: true,
        seen: 1,
      }),
    ).toBe(true);
  });

  it('hides the pending bubble once that user message lands', () => {
    expect(
      pendingTranscriptTexts({
        optimistic: [],
        messages: [{ role: 'user', text: 'Issue A' }],
        currentTurnPrompt: null,
        pendingUser: 'Issue A',
        pendingInTranscript: true,
      }),
    ).toEqual([]);
  });

  it('shows a resend that optimistic still tracks', () => {
    expect(
      pendingTranscriptTexts({
        optimistic: [{ text: 'yes', seen: 1 }],
        messages: [{ role: 'user', text: 'yes' }],
        currentTurnPrompt: 'yes',
        pendingUser: 'yes',
        pendingInTranscript: true,
      }),
    ).toEqual(['yes']);
  });

  it('shows the queued head when an older message has the same text', () => {
    expect(
      pendingTranscriptTexts({
        optimistic: [],
        messages: [{ role: 'user', text: 'yes' }],
        currentTurnPrompt: 'yes',
        pendingUser: null,
        pendingInTranscript: false,
      }),
    ).toEqual(['yes']);
  });
});

describe('shouldShowStreamingTurn', () => {
  it('keeps a partial reply on screen after Stop', () => {
    expect(
      shouldShowStreamingTurn({
        status: 'stopped',
        liveOutput: 'partial',
        livePartCount: 1,
      }),
    ).toBe(true);
  });

  it('hides the empty thinking row once the turn has stopped', () => {
    expect(
      shouldShowStreamingTurn({
        status: 'stopped',
        liveOutput: '',
        livePartCount: 0,
        turnStartedAt: 1,
      }),
    ).toBe(false);
  });

  it('shows the thinking row while the turn is running', () => {
    expect(
      shouldShowStreamingTurn({
        status: 'running',
        liveOutput: '',
        livePartCount: 0,
      }),
    ).toBe(true);
  });
});

describe('unlandedFollowUps', () => {
  it('drops a chip once the transcript has the send, even if it never stayed in the queue', () => {
    expect(
      unlandedFollowUps(
        [{ id: 'a', text: 'do this', seen: 0 }],
        [],
        [
          { role: 'user', text: 'do this' },
          { role: 'agent', text: 'working' },
        ],
      ),
    ).toEqual([]);
  });

  it('keeps a resend until that copy lands in the queue or the transcript', () => {
    expect(
      unlandedFollowUps([{ id: 'a', text: 'do this', seen: 1 }], [], [{ role: 'user', text: 'do this' }]),
    ).toEqual([{ id: 'a', text: 'do this', seen: 1 }]);
  });

  it('remembers a chip the saved queue is showing so the next copy is not consumed early', () => {
    const queued = unlandedFollowUps(
      [
        { id: 'a', text: 'same', seen: 0 },
        { id: 'b', text: 'same', seen: 0 },
      ],
      ['same'],
      [],
    );
    expect(queued).toEqual([
      { id: 'a', text: 'same', seen: 0, queued: true },
      { id: 'b', text: 'same', seen: 0 },
    ]);
    const waitingForTranscript = unlandedFollowUps(queued, [], []);
    expect(waitingForTranscript).toEqual(queued);
    expect(unlandedFollowUps(waitingForTranscript, [], [{ role: 'user', text: 'same' }])).toEqual([
      { id: 'b', text: 'same', seen: 0 },
    ]);
  });

  it('drops the chip the user removed, not the later same-text send', () => {
    const pending = [
      { id: 'a', text: 'same', seen: 0, queued: true },
      { id: 'b', text: 'same', seen: 0 },
    ];
    expect(dropRemovedFollowUp(pending, 'same')).toEqual([{ id: 'b', text: 'same', seen: 0 }]);
  });

  it('drops only the copies that have landed', () => {
    expect(
      unlandedFollowUps(
        [
          { id: 'a', text: 'same', seen: 0 },
          { id: 'b', text: 'same', seen: 0 },
        ],
        [],
        [{ role: 'user', text: 'same' }],
      ),
    ).toEqual([{ id: 'b', text: 'same', seen: 0 }]);
  });
});

describe('extraPendingFollowUps', () => {
  it('keeps optimistic items that have not landed', () => {
    expect(
      extraPendingFollowUps(['one'], [
        { id: 'a', text: 'one' },
        { id: 'b', text: 'two' },
      ]),
    ).toEqual([{ id: 'b', text: 'two' }]);
  });

  it('keeps a second copy when only one has landed', () => {
    expect(
      extraPendingFollowUps(['same'], [
        { id: 'a', text: 'same' },
        { id: 'b', text: 'same' },
      ]),
    ).toEqual([{ id: 'b', text: 'same' }]);
  });
});
