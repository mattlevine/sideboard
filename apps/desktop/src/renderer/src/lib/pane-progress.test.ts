import { describe, expect, it } from 'vitest';
import {
  shouldHoldCreateOverlay,
  threadHasVisibleFirstTurn,
  type CreatePaneProgress,
  type FirstTurnThread,
} from './pane-progress';

function thread(partial: Partial<FirstTurnThread> & Pick<FirstTurnThread, 'id'>): FirstTurnThread {
  return {
    id: partial.id,
    messages: partial.messages ?? [],
    lastError: partial.lastError ?? null,
    status: partial.status ?? 'idle',
  };
}

const creating: CreatePaneProgress = {
  mode: 'create',
  repoName: 'sideboard',
  selectionHint: 'default branch',
  threadId: 't1',
  awaitingFirstPrompt: true,
};

describe('threadHasVisibleFirstTurn', () => {
  it('is false for a brand-new empty thread', () => {
    expect(threadHasVisibleFirstTurn(thread({ id: 't1' }))).toBe(false);
  });

  it('is true once a message lands', () => {
    expect(
      threadHasVisibleFirstTurn(thread({ id: 't1', messages: [{ role: 'user' }] })),
    ).toBe(true);
  });

  it('is true when the first prompt failed', () => {
    expect(
      threadHasVisibleFirstTurn(thread({ id: 't1', lastError: 'First prompt failed' })),
    ).toBe(true);
  });

  it('ignores setup lastError while the first agent turn is still running', () => {
    expect(
      threadHasVisibleFirstTurn(
        thread({
          id: 't1',
          status: 'running',
          lastError: 'Setup exited 1',
        }),
      ),
    ).toBe(false);
  });
});

describe('shouldHoldCreateOverlay', () => {
  it('holds while create is in progress and nothing is selected', () => {
    expect(shouldHoldCreateOverlay({ paneProgress: creating, selected: null })).toBe(
      true,
    );
  });

  it('holds on the new thread until the first message appears', () => {
    expect(
      shouldHoldCreateOverlay({
        paneProgress: creating,
        selected: thread({ id: 't1' }),
      }),
    ).toBe(true);
  });

  it('releases once the first message is visible', () => {
    expect(
      shouldHoldCreateOverlay({
        paneProgress: creating,
        selected: thread({ id: 't1', messages: [{ role: 'user' }] }),
      }),
    ).toBe(false);
  });

  it('does not cover a different thread the user opened meanwhile', () => {
    expect(
      shouldHoldCreateOverlay({
        paneProgress: creating,
        selected: thread({ id: 'other' }),
      }),
    ).toBe(false);
  });

  it('does not hold when create had no first prompt', () => {
    expect(
      shouldHoldCreateOverlay({
        paneProgress: { ...creating, awaitingFirstPrompt: false },
        selected: thread({ id: 't1' }),
      }),
    ).toBe(false);
  });
});
