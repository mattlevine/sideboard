import { describe, expect, it } from 'vitest';
import type { Thread } from '@sideboard-ai/core';
import { GLOBAL_WORKSPACE_ID } from './global-workspace';
import { connectedOrchestrator } from './connected-orchestrator';

function node(
  partial: Pick<Thread, 'id'> & Partial<Pick<Thread, 'parentThreadId' | 'sourceType' | 'repoPath' | 'title'>>,
): Pick<Thread, 'id' | 'parentThreadId' | 'sourceType' | 'repoPath' | 'title'> {
  return {
    parentThreadId: null,
    sourceType: 'branch',
    repoPath: '/repos/sideboard',
    title: partial.id,
    ...partial,
  };
}

describe('connectedOrchestrator', () => {
  it('finds the orchestrator through a sibling parent', () => {
    const orch = node({
      id: 'orch',
      sourceType: 'orchestration',
      repoPath: GLOBAL_WORKSPACE_ID,
      title: 'Fleet',
    });
    const agent = node({ id: 'agent', parentThreadId: 'orch' });
    const review = node({ id: 'review', parentThreadId: 'agent', title: 'Review' });
    const find = (id: string) => [orch, agent, review].find((row) => row.id === id) ?? null;
    expect(connectedOrchestrator(review, find)?.title).toBe('Fleet');
    expect(connectedOrchestrator(orch, find)).toBeNull();
  });
});
