import { describe, expect, it } from 'vitest';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import type { Thread } from '../types/thread.js';
import { planOrchestrationQuotaFailover } from './quota-failover.js';

function orchThread(over: Partial<Thread> = {}): Thread {
  return {
    id: 'orch-1',
    title: 'Arsenal',
    sourceType: 'orchestration',
    sourceRef: 'Ship the feature',
    branchName: 'global',
    worktreePath: '/tmp/global',
    repoPath: GLOBAL_WORKSPACE_ID,
    agent: 'claude',
    model: null,
    effort: 'high',
    fast: false,
    planMode: false,
    sessionId: null,
    autonomy: 'default',
    sourceIsFork: false,
    status: 'error',
    queue: [],
    parentThreadId: null,
    devPort: null,
    activeRuns: [],
    prUrl: null,
    prTitle: null,
    userSetTitle: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    attachments: [],
    ...over,
  };
}

const LIMIT =
  "You've hit your session limit · resets 7:10pm (America/Los_Angeles)";

describe('planOrchestrationQuotaFailover', () => {
  it('defaults to switch_agent with Auto fallback', () => {
    const plan = planOrchestrationQuotaFailover(orchThread(), LIMIT, {
      onLimit: 'switch_agent',
      fallbackAgent: 'cursor',
    });
    expect(plan?.action).toBe('switch_agent');
    expect(plan?.fallbackAgent).toBe('cursor');
  });

  it('wait_reset when configured', () => {
    const now = new Date('2026-08-09T18:00:00.000Z');
    const plan = planOrchestrationQuotaFailover(orchThread(), LIMIT, {
      onLimit: 'wait_reset',
      now,
    });
    expect(plan?.action).toBe('wait_reset');
    expect(plan?.resumeAt).toBeInstanceOf(Date);
  });

  it('does not cascade after an existing continue', () => {
    const now = new Date('2026-08-09T18:00:00.000Z');
    const plan = planOrchestrationQuotaFailover(
      orchThread({ agent: 'cursor', quotaContinuedFromId: 'orch-1' }),
      LIMIT,
      { onLimit: 'switch_agent', fallbackAgent: 'codex', now },
    );
    expect(plan?.action).toBe('wait_reset');
  });

  it('ignores non-orchestration and non-quota failures', () => {
    expect(
      planOrchestrationQuotaFailover(
        orchThread({ sourceType: 'branch', repoPath: '/repo' }),
        LIMIT,
      ),
    ).toBeNull();
    expect(
      planOrchestrationQuotaFailover(orchThread(), 'Prompt is too long'),
    ).toBeNull();
  });
});
