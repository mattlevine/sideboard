import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { worktreeAgentBlock, visibleAgentBlock } from '../board/home-board.js';
import { planQuestionsSignature } from '../plan/ask-user.js';
import {
  createEmptyThread,
  invalidateThreadListCache,
  readThread,
  writeThread,
} from '../store/thread-store.js';
import type { MessagePart } from '../types/thread.js';
import {
  agentBlockAfterTurn,
  clampBlockReason,
  decisionBlockFromParts,
  dismissAskUserQuestion,
  makeAgentBlock,
  settleAgentBlock,
  writeAgentBlock,
} from './agent-block.js';

const askSignature = planQuestionsSignature([
  {
    question: 'Which API?',
    options: [{ label: 'REST' }, { label: 'GraphQL' }],
  },
]);

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
      questionSignature: askSignature,
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
    const later: MessagePart = { type: 'tool', id: 'r1', name: 'Read', status: 'done' };
    expect(decisionBlockFromParts([plan, later], true)).toBeNull();
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

  it('does not restore an ask the user already skipped', () => {
    const stamped = {
      ...makeAgentBlock('ask_user', 'Asked the user: Which API?', 't'),
      questionSignature: askSignature,
    };
    expect(
      agentBlockAfterTurn({
        existing: stamped,
        parts: [askUser],
        planMode: false,
        failed: false,
        dismissedQuestionSignature: askSignature,
      }),
    ).toBeNull();
  });

  it('drops an ask_user stamp once a later tool runs', () => {
    const stamped = makeAgentBlock('ask_user', 'Asked the user: Which API?', 't');
    const later: MessagePart = { type: 'tool', id: 'r1', name: 'Read', status: 'done' };
    expect(
      agentBlockAfterTurn({
        existing: stamped,
        parts: [askUser, later],
        planMode: false,
        failed: false,
      }),
    ).toBeNull();
    expect(
      agentBlockAfterTurn({
        existing: stamped,
        parts: [],
        planMode: false,
        failed: false,
      }),
    ).toBe(stamped);
  });
});

describe('visibleAgentBlock', () => {
  it('hides an ask the chat already skipped and keeps a newer one', () => {
    const skipped = {
      source: 'ask_user' as const,
      reason: 'Asked the user: Which API?',
      at: 't',
      questionSignature: askSignature,
    };
    expect(
      visibleAgentBlock({
        status: 'idle',
        agentBlock: skipped,
        dismissedQuestionSignature: askSignature,
      }),
    ).toBeNull();
    expect(
      visibleAgentBlock({
        status: 'idle',
        agentBlock: { ...skipped, questionSignature: 'other' },
        dismissedQuestionSignature: askSignature,
      })?.reason,
    ).toBe('Asked the user: Which API?');
    expect(
      worktreeAgentBlock([
        {
          status: 'idle',
          agentBlock: skipped,
          dismissedQuestionSignature: askSignature,
        },
        {
          status: 'idle',
          agentBlock: { source: 'reported', reason: 'Need a token', at: 'u' },
        },
      ])?.reason,
    ).toBe('Need a token');
  });
});

describe('dismissAskUserQuestion', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-ask-dismiss-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    invalidateThreadListCache();
  });

  afterEach(() => {
    invalidateThreadListCache();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function persist() {
    const thread = createEmptyThread({
      title: 'ask',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/ask',
      worktreePath: '/tmp/ask',
      repoPath: '/tmp/repo',
      agent: 'claude',
    });
    writeThread(thread);
    return thread;
  }

  it('clears the sidebar ask and keeps the skip so the turn end cannot restore it', () => {
    const thread = persist();
    writeAgentBlock(thread.id, {
      ...makeAgentBlock('ask_user', 'Asked the user: Which API?'),
      questionSignature: askSignature,
    });
    dismissAskUserQuestion(thread.id, askSignature);
    expect(readThread(thread.id)?.agentBlock).toBeNull();
    expect(readThread(thread.id)?.dismissedQuestionSignature).toBe(askSignature);
    settleAgentBlock(thread.id, [askUser], false);
    expect(readThread(thread.id)?.agentBlock).toBeNull();
  });

  it('leaves a reported block in place', () => {
    const thread = persist();
    writeAgentBlock(thread.id, makeAgentBlock('reported', 'Need a token'));
    dismissAskUserQuestion(thread.id, askSignature);
    expect(readThread(thread.id)?.agentBlock?.source).toBe('reported');
    expect(readThread(thread.id)?.dismissedQuestionSignature).toBe(askSignature);
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
