import { describe, expect, it } from 'vitest';
import type { MessagePart } from '../types/thread.js';
import {
  deriveTaskState,
  endedOnAskUser,
  isIncompleteTaskState,
  isTerminalTaskState,
  needsCoordinatorAction,
} from './task-state.js';

const askUser: MessagePart = {
  type: 'tool',
  id: '1',
  name: 'ask_user',
  status: 'done',
};

describe('endedOnAskUser', () => {
  it('is true when the last top-level tool is ask_user', () => {
    expect(endedOnAskUser([askUser])).toBe(true);
    expect(
      endedOnAskUser([
        { type: 'text', text: 'Need a choice.' },
        { type: 'tool', id: '2', name: 'mcp__sideboard__ask_user', status: 'done' },
      ]),
    ).toBe(true);
  });

  it('ignores nested ask_user and earlier tools', () => {
    expect(
      endedOnAskUser([
        { type: 'tool', id: '1', name: 'ask_user', status: 'done', parentId: 'task' },
        { type: 'tool', id: '2', name: 'Read', status: 'done' },
      ]),
    ).toBe(false);
    expect(endedOnAskUser([{ type: 'text', text: 'done' }])).toBe(false);
    expect(endedOnAskUser(undefined)).toBe(false);
  });
});

describe('deriveTaskState', () => {
  it('maps live queued vs running', () => {
    expect(
      deriveTaskState({ status: 'queued', stillRunning: true }),
    ).toBe('submitted');
    expect(
      deriveTaskState({ status: 'running', stillRunning: true }),
    ).toBe('working');
  });

  it('maps terminal statuses', () => {
    expect(
      deriveTaskState({ status: 'error', stillRunning: false }),
    ).toBe('failed');
    expect(
      deriveTaskState({ status: 'broken', stillRunning: false }),
    ).toBe('failed');
    expect(
      deriveTaskState({ status: 'stopped', stillRunning: false }),
    ).toBe('canceled');
    expect(
      deriveTaskState({ status: 'idle', stillRunning: false }),
    ).toBe('completed');
  });

  it('is input-required when the finished turn ended on ask_user', () => {
    expect(
      deriveTaskState({
        status: 'idle',
        stillRunning: false,
        lastAgentParts: [askUser],
      }),
    ).toBe('input-required');
    expect(
      deriveTaskState({
        status: 'running',
        stillRunning: true,
        lastAgentParts: [askUser],
      }),
    ).toBe('working');
  });

  it('stays input-required when a later tool ran after ask_user', () => {
    const later: MessagePart = { type: 'tool', id: '2', name: 'Read', status: 'done' };
    expect(
      deriveTaskState({
        status: 'idle',
        stillRunning: false,
        lastAgentParts: [askUser, later],
      }),
    ).toBe('input-required');
    expect(
      deriveTaskState({
        status: 'idle',
        stillRunning: false,
        lastAgentParts: [
          { type: 'tool', id: '1', name: 'ask_user', status: 'done', parentId: 'task' },
          later,
        ],
      }),
    ).toBe('completed');
  });

  it('is completed after the question is skipped or the user replies', () => {
    const asked: MessagePart = {
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
    const later: MessagePart = { type: 'tool', id: '2', name: 'Read', status: 'done' };
    expect(
      deriveTaskState({
        status: 'idle',
        stillRunning: false,
        lastAgentParts: [asked, later],
        dismissedQuestionSignature:
          'Which API?\u001eREST\u001fGraphQL',
      }),
    ).toBe('completed');
    expect(
      deriveTaskState({
        status: 'idle',
        stillRunning: false,
        lastAgentParts: [asked, later],
        userAnswered: true,
      }),
    ).toBe('completed');
  });
});

describe('taskState helpers', () => {
  it('treats submitted/working as non-terminal', () => {
    expect(isTerminalTaskState('working')).toBe(false);
    expect(isTerminalTaskState('submitted')).toBe(false);
    expect(isTerminalTaskState('completed')).toBe(true);
    expect(isIncompleteTaskState('failed')).toBe(true);
    expect(isIncompleteTaskState('canceled')).toBe(true);
    expect(isIncompleteTaskState('completed')).toBe(false);
    expect(needsCoordinatorAction('input-required')).toBe(true);
    expect(needsCoordinatorAction('completed')).toBe(false);
  });
});
