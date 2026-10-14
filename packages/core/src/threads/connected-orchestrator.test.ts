import { describe, expect, it } from 'vitest';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import { connectedOrchestrator } from './connected-orchestrator.js';

type Node = {
  id: string;
  parentThreadId: string | null;
  sourceType: 'branch' | 'orchestration';
  repoPath: string;
  title: string;
};

function node(partial: Partial<Node> & Pick<Node, 'id'>): Node {
  return {
    parentThreadId: null,
    sourceType: 'branch',
    repoPath: '/repos/sideboard',
    title: partial.id,
    ...partial,
  };
}

describe('connectedOrchestrator', () => {
  const orch = node({
    id: 'orch',
    sourceType: 'orchestration',
    repoPath: GLOBAL_WORKSPACE_ID,
    title: 'Fleet',
  });
  const agent = node({ id: 'agent', parentThreadId: 'orch', title: 'Implement' });
  const sibling = node({ id: 'sibling', parentThreadId: 'agent', title: 'Review' });
  const lone = node({ id: 'lone', title: 'Local' });
  const all = [orch, agent, sibling, lone];
  const find = (id: string) => all.find((row) => row.id === id) ?? null;

  it('returns the orchestration chat an agent was opened from', () => {
    expect(connectedOrchestrator(agent, find)?.id).toBe('orch');
  });

  it('walks a forked agent back to that same orchestrator', () => {
    expect(connectedOrchestrator(sibling, find)?.title).toBe('Fleet');
  });

  it('is empty when the chat has no orchestrator', () => {
    expect(connectedOrchestrator(lone, find)).toBeNull();
  });

  it('does not treat an orchestration chat as connected to itself', () => {
    expect(connectedOrchestrator(orch, find)).toBeNull();
  });
});
