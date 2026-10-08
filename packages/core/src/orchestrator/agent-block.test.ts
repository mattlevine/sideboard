import { describe, expect, it } from 'vitest';
import { worktreeAgentBlock } from '../board/home-board.js';
import type { MessagePart } from '../types/thread.js';
import {
  agentBlockAfterTurn,
  clampBlockReason,
  decisionBlockFromParts,
  makeAgentBlock,
} from './agent-block.js';

const askUser: MessagePart = {
  type: 'tool',
  id: 'q1',
  name: 'ask_user',
  status: 'done',
  input: {
    questions: [
      {
        question: 'Which API?',
        options: [{ label: 'REST' }, { label: 'GraphQL' }],
      },
    ],
  },
};

describe('decisionBlockFromParts', () => {
  it('blocks on the last ask_user and includes the question', () => {
    const block = decisionBlockFromParts([askUser], false, 't');
    expect(block).toEqual({
      source: 'ask_user',
      reason: 'Asked the user: Which API?',
      at: 't',
    });
  });

  it('does not treat an earlier ask_user as blocking after more work', () => {
    const later: MessagePart = {
      type: 'tool',
      id: 'r1',
      name: 'Read',
      status: 'done',
    };
    expect(decisionBlockFromParts([askUser, later], false)).toBeNull();
  });

  it('blocks on plan approval only when plan mode presented a plan', () => {
    const plan: MessagePart = {
      type: 'tool',
      id: 'p1',
      name: 'present_plan',
      status: 'done',
      input: { title: 'Ship blocked', content: '# Plan\nDo the thing.' },
    };
    expect(decisionBlockFromParts([plan], false)).toBeNull();
    expect(decisionBlockFromParts([plan], true, 't')).toEqual({
      source: 'plan',
      reason: 'Waiting for plan approval: Ship blocked',
      at: 't',
    });
  });

  it('lets a question win over a plan in the same turn', () => {
    const plan: MessagePart = {
      type: 'tool',
      id: 'p1',
      name: 'present_plan',
      status: 'done',
      input: { title: 'Ship', content: '# Plan' },
    };
    expect(decisionBlockFromParts([plan, askUser], true)?.source).toBe('ask_user');
  });
});

describe('agentBlockAfterTurn', () => {
  it('clears on failure and keeps a reported block when the turn just stops', () => {
    const reported = makeAgentBlock('reported', 'Need a Linear token', 't');
    expect(
      agentBlockAfterTurn({
        existing: reported,
        parts: [],
        planMode: false,
        failed: true,
      }),
    ).toBeNull();
    expect(
      agentBlockAfterTurn({
        existing: reported,
        parts: [],
        planMode: false,
        failed: false,
      }),
    ).toBe(reported);
  });
});

describe('worktreeAgentBlock', () => {
  it('surfaces a blocked sibling ahead of a working one and hides errors', () => {
    expect(
      worktreeAgentBlock([
        { status: 'running', agentBlock: null },
        {
          status: 'idle',
          agentBlock: { source: 'reported', reason: 'Need a token', at: 't' },
        },
      ])?.reason,
    ).toBe('Need a token');
    expect(
      worktreeAgentBlock([
        {
          status: 'error',
          agentBlock: { source: 'reported', reason: 'Need a token', at: 't' },
        },
      ]),
    ).toBeNull();
  });
});

describe('clampBlockReason', () => {
  it('collapses whitespace and caps length', () => {
    expect(clampBlockReason('  need\naccess  ')).toBe('need access');
    expect(clampBlockReason('x'.repeat(300)).endsWith('…')).toBe(true);
    expect(clampBlockReason('x'.repeat(300)).length).toBe(240);
  });
});
