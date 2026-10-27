import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import { createEmptyThread, readThread, writeThread } from '../store/thread-store.js';
import type { Thread } from '../types/thread.js';
import {
  createQuotaFailoverChat,
  isolateQuotaFailover,
  planOrchestrationQuotaFailover,
} from './quota-failover.js';

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
    prState: null,
    stackId: null,
    stackLayer: null,
    userSetTitle: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    attachments: [],
    ...over,
  } as Thread;
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

  it('switches a worktree chat the same way as orchestration', () => {
    const plan = planOrchestrationQuotaFailover(
      orchThread({ sourceType: 'branch', repoPath: '/repo' }),
      LIMIT,
      { onLimit: 'switch_agent', fallbackAgent: 'cursor' },
    );
    expect(plan?.action).toBe('switch_agent');
    expect(plan?.fallbackAgent).toBe('cursor');
  });

  it('switches to the next managed account when configured', () => {
    const plan = planOrchestrationQuotaFailover(orchThread({ accountId: 'a' }), LIMIT, {
      onLimit: 'switch_account',
      accounts: {
        accounts: [
          {
            id: 'a',
            kind: 'claude',
            label: 'work',
            configDir: '/tmp/a',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'b',
            kind: 'claude',
            label: 'personal',
            configDir: '/tmp/b',
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        activeClaudeAccountId: 'a',
        activeCodexAccountId: null,
      },
    });
    expect(plan?.action).toBe('switch_account');
    expect(plan?.fallbackAccountId).toBe('b');
    expect(plan?.fallbackAccountLabel).toBe('personal');
  });

  it('does nothing for switch_account when no other account exists', () => {
    const plan = planOrchestrationQuotaFailover(orchThread(), LIMIT, {
      onLimit: 'switch_account',
      accounts: {
        accounts: [],
        activeClaudeAccountId: null,
        activeCodexAccountId: null,
      },
    });
    expect(plan?.action).toBe('none');
  });

  it('does nothing when the policy is keep going or confirm', () => {
    expect(
      planOrchestrationQuotaFailover(orchThread(), LIMIT, { onLimit: 'keep_going' })
        ?.action,
    ).toBe('none');
    expect(
      planOrchestrationQuotaFailover(orchThread(), LIMIT, { onLimit: 'confirm' })
        ?.action,
    ).toBe('none');
  });

  it('ignores non-quota failures', () => {
    expect(
      planOrchestrationQuotaFailover(orchThread(), 'Prompt is too long'),
    ).toBeNull();
  });
});

describe('createQuotaFailoverChat', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-quota-failover-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
    process.env.SIDEBOARD_SECRET_VAULT = 'plain';
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    delete process.env.SIDEBOARD_SECRET_VAULT;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('copies a one-off automation onto the continuation', () => {
    const source = createEmptyThread({
      title: 'Standup',
      sourceType: 'orchestration',
      sourceRef: 'go',
      branchName: 'global',
      worktreePath: '/tmp/global',
      repoPath: GLOBAL_WORKSPACE_ID,
      agent: 'claude',
      status: 'error',
    });
    const from = { ...source, ephemeralAutomationId: 'auto-1', userSetTitle: true };
    writeThread(from);

    const next = createQuotaFailoverChat(from, 'cursor', LIMIT);

    expect(next.ephemeralAutomationId).toBe('auto-1');
    expect(next.title).toBe('Standup');
    expect(next.agent).toBe('cursor');
    expect(next.quotaContinuedFromId).toBe(from.id);
    expect(readThread(from.id)?.ephemeralAutomationId).toBe('auto-1');
  });
});

describe('isolateQuotaFailover', () => {
  it('returns the handler result when failover succeeds', async () => {
    expect(await isolateQuotaFailover(async () => true)).toBe(true);
    expect(await isolateQuotaFailover(async () => false)).toBe(false);
  });

  it('treats sibling-create or appendMessage throws as handled', async () => {
    await expect(
      isolateQuotaFailover(async () => {
        throw new Error('appendMessage failed after sibling create');
      }),
    ).resolves.toBe(true);
  });
});
