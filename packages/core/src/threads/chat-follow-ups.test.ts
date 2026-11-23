import { describe, expect, it } from 'vitest';
import {
  addChatFollowUp,
  decideFollowUps,
  mergeFollowUpPoll,
  type ChatFollowUp,
} from './chat-follow-ups.js';

const now = new Date('2026-11-22T12:00:00.000Z');

function ci(partial: Partial<ChatFollowUp> = {}): ChatFollowUp {
  return {
    id: 'ci-1',
    kind: 'ci',
    prompt: 'CI finished',
    deadline: '2026-11-29T12:00:00.000Z',
    createdAt: now.toISOString(),
    ciBaseline: 'pending',
    ...partial,
  };
}

describe('decideFollowUps', () => {
  it('sends a CI follow-up when checks finish and drops it when they never do', () => {
    const pending = decideFollowUps({
      followUps: [ci()],
      now,
      ci: 'pending',
    });
    expect(pending.fire).toEqual([]);
    expect(pending.keep).toHaveLength(1);
    expect(pending.keep[0]?.ciSawPending).toBe(true);

    const done = decideFollowUps({
      followUps: [ci()],
      now,
      ci: 'done',
    });
    expect(done.fire.map((item) => item.id)).toEqual(['ci-1']);
    expect(done.keep).toEqual([]);

    const expired = decideFollowUps({
      followUps: [ci({ deadline: '2026-11-22T11:00:00.000Z' })],
      now,
      ci: 'pending',
    });
    expect(expired.fire).toEqual([]);
    expect(expired.keep).toEqual([]);
  });

  it('does not send on a failed checks read, then sends after a real run', () => {
    const unknown = decideFollowUps({
      followUps: [ci({ ciBaseline: 'unknown' })],
      now,
      ci: 'done',
    });
    expect(unknown.fire).toEqual([]);
    expect(unknown.keep[0]?.ciSawPending).toBeUndefined();

    const blip = decideFollowUps({
      followUps: [ci({ ciBaseline: 'done' })],
      now,
      ci: 'unknown',
    });
    expect(blip.fire).toEqual([]);
    expect(blip.keep[0]?.ciSawPending).toBeUndefined();

    const saw = decideFollowUps({
      followUps: [ci({ ciBaseline: 'unknown' })],
      now,
      ci: 'pending',
    });
    expect(saw.keep[0]?.ciSawPending).toBe(true);
    const finished = decideFollowUps({
      followUps: saw.keep,
      now,
      ci: 'done',
    });
    expect(finished.fire).toHaveLength(1);
  });

  it('does not send when checks were already finished', () => {
    const decision = decideFollowUps({
      followUps: [ci({ ciBaseline: 'done' })],
      now,
      ci: 'done',
    });
    expect(decision.fire).toEqual([]);
    expect(decision.keep).toHaveLength(1);

    const later = decideFollowUps({
      followUps: [ci({ ciBaseline: 'done', ciSawPending: true })],
      now,
      ci: 'done',
    });
    expect(later.fire).toHaveLength(1);
  });

  it('sends a time follow-up when it is due and joins a queued turn', () => {
    const waiting = decideFollowUps({
      followUps: [
        {
          id: 'at-1',
          kind: 'at',
          prompt: 'check back',
          at: '2026-11-22T13:00:00.000Z',
          deadline: '2026-11-22T13:00:00.000Z',
          createdAt: now.toISOString(),
        },
      ],
      now,
      ci: 'none',
    });
    expect(waiting.fire).toEqual([]);
    const due = decideFollowUps({
      followUps: waiting.keep,
      now: new Date('2026-11-22T13:00:00.000Z'),
      ci: 'none',
    });
    expect(due.fire.map((item) => item.prompt)).toEqual(['check back']);
  });

  it('keeps follow-ups saved or deleted while a poll was in flight', () => {
    const before = [ci(), { ...ci(), id: 'ci-2' }];
    const added = { ...ci(), id: 'ci-3', prompt: 'added' };
    const afterDelete = [ci(), added];
    expect(
      mergeFollowUpPoll({
        before,
        after: afterDelete,
        firedIds: [],
        keep: before,
      }).map((item) => item.id),
    ).toEqual(['ci-1', 'ci-3']);

    expect(
      mergeFollowUpPoll({
        before: [ci()],
        after: [ci(), added],
        firedIds: ['ci-1'],
        keep: [],
      }).map((item) => item.id),
    ).toEqual(['ci-3']);

    const latched = mergeFollowUpPoll({
      before: [ci()],
      after: [{ ...ci(), prompt: 'edited' }],
      firedIds: [],
      keep: [{ ...ci(), ciSawPending: true }],
    });
    expect(latched).toEqual([{ ...ci(), prompt: 'edited', ciSawPending: true }]);
  });

  it('caps a chat at 10 follow-ups', () => {
    let followUps: ChatFollowUp[] = [];
    for (let i = 0; i < 10; i += 1) {
      const added = addChatFollowUp(followUps, { kind: 'ci', prompt: `n${i}` }, now);
      expect(added.ok).toBe(true);
      if (added.ok) followUps = added.followUps;
    }
    const extra = addChatFollowUp(followUps, { kind: 'ci', prompt: 'nope' }, now);
    expect(extra.ok).toBe(false);
  });
});
