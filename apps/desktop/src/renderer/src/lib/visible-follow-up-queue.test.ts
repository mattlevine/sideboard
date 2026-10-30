import { describe, expect, it } from 'vitest';
import {
  extraPendingFollowUps,
  joinSteerPrompt,
  pendingTranscriptTexts,
  splitTurnQueue,
  unlandedFollowUps,
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
    expect(unlandedFollowUps(queued, [], [{ role: 'user', text: 'same' }])).toEqual([
      { id: 'b', text: 'same', seen: 0 },
    ]);
  });

  it('drops a chip the user removed from the queue', () => {
    const queued = unlandedFollowUps([{ id: 'a', text: 'later', seen: 0 }], ['later'], []);
    expect(unlandedFollowUps(queued, [], [])).toEqual([]);
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
