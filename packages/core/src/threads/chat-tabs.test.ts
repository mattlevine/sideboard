import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FAMOUS_SOCCER_TEAMS } from '../git/teams.js';
import type { Thread } from '../types/thread.js';

const source: Thread = {
  id: 'source-thread-id',
  title: 'West Ham',
  sourceType: 'branch',
  sourceRef: 'main',
  branchName: 'thread/west-ham',
  worktreePath: '/Users/me/sideboard/workspaces/sideboard/west-ham',
  repoPath: '/Users/me/Projects/sideboard',
  agent: 'claude',
  model: null,
  effort: 'high' as const,
  fast: false,
  planMode: false,
  sessionId: 'sess-1',
  autonomy: 'default',
  sourceIsFork: false,
  status: 'idle',
  queue: [],
  parentThreadId: null,
  devPort: null,
  prUrl: null,
  prTitle: null,
  prState: null,
  stackId: null,
  stackLayer: null,
  userSetTitle: false,
  createdAt: '2026-08-01T23:10:10.000Z',
  updatedAt: '2026-08-01T23:10:10.000Z',
  messages: [
    { role: 'user', text: 'hello', ts: '2026-08-01T23:10:11.000Z' },
    { role: 'agent', text: 'hi', ts: '2026-08-01T23:10:12.000Z' },
  ],
  attachments: [],
};

let written: Thread | null = null;
let listed: Thread[] = [source];
const teamNames = new Set(FAMOUS_SOCCER_TEAMS.map((t) => t.name));

vi.mock('../store/thread-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/thread-store.js')>();
  return {
    ...actual,
    findThreadByRef: (ref: string) =>
      listed.find((t) => t.id === ref || t.id.startsWith(ref)) ?? null,
    listThreads: () => listed,
    writeThread: (thread: Thread) => {
      written = thread;
    },
  };
});

describe('forkChatTab', () => {
  beforeEach(() => {
    written = null;
    listed = [source];
  });

  it('inherits the source thread worktree binding (no new git worktree)', async () => {
    const { forkChatTab } = await import('./chat-tabs.js');
    const forked = forkChatTab({ threadId: source.id, throughIndex: 1 });

    expect(forked.worktreePath).toBe(source.worktreePath);
    expect(forked.repoPath).toBe(source.repoPath);
    expect(forked.branchName).toBe(source.branchName);
    expect(forked.sessionId).toBeNull();
    expect(forked.messages).toEqual([]);
    expect(forked.attachments).toHaveLength(1);
    expect(forked.attachments[0]?.kind).toBe('transcript');
    expect(written?.worktreePath).toBe(source.worktreePath);
    expect(written?.branchName).toBe(source.branchName);
  });

  it('names the forked tab after a soccer team unused by siblings', async () => {
    const { forkChatTab } = await import('./chat-tabs.js');
    const forked = forkChatTab({ threadId: source.id, throughIndex: 1 });

    expect(teamNames.has(forked.title)).toBe(true);
    expect(forked.title).not.toBe(source.title);
    expect(forked.userSetTitle).toBe(true);
  });

  it('forks Global orchestration chats into another orchestration tab', async () => {
    const { GLOBAL_WORKSPACE_ID } = await import('../store/global-workspace.js');
    const orch: Thread = {
      ...source,
      id: 'orch-source',
      title: 'Arsenal',
      sourceType: 'orchestration',
      sourceRef: 'Ship it',
      branchName: 'global',
      worktreePath: '/tmp/sideboard-global',
      repoPath: GLOBAL_WORKSPACE_ID,
      parentThreadId: null,
    };
    listed = [orch];
    const { forkChatTab } = await import('./chat-tabs.js');
    const forked = forkChatTab({
      threadId: orch.id,
      agent: 'cursor',
      model: null,
    });
    expect(forked.sourceType).toBe('orchestration');
    expect(forked.repoPath).toBe(GLOBAL_WORKSPACE_ID);
    expect(forked.agent).toBe('cursor');
    expect(forked.model).toBeNull();
    expect(forked.parentThreadId).toBe(orch.id);
    expect(forked.attachments[0]?.kind).toBe('transcript');
  });
});

describe('createChatTab', () => {
  beforeEach(() => {
    written = null;
    listed = [source];
  });

  it('adds a chat tab without changing worktree path, branch, or folder identity', async () => {
    const { createChatTab } = await import('./chat-tabs.js');
    const tab = createChatTab({ fromThreadId: source.id, title: 'Context manager' });

    expect(tab.worktreePath).toBe(source.worktreePath);
    expect(tab.branchName).toBe(source.branchName);
    expect(tab.repoPath).toBe(source.repoPath);
    expect(tab.title).toBe('Context manager');
    expect(written?.worktreePath).toBe(source.worktreePath);
    expect(written?.branchName).toBe(source.branchName);
  });

  it('defaults new tabs to a random soccer team name', async () => {
    const { createChatTab } = await import('./chat-tabs.js');
    const tab = createChatTab({ fromThreadId: source.id });

    expect(teamNames.has(tab.title)).toBe(true);
    expect(tab.title).not.toBe(source.title);
    expect(tab.userSetTitle).toBe(true);
  });

  it('can override thinking effort from account / picker defaults', async () => {
    const { createChatTab } = await import('./chat-tabs.js');
    const tab = createChatTab({ fromThreadId: source.id, effort: 'low' });
    expect(tab.effort).toBe('low');
    expect(source.effort).toBe('high');
  });

  it('does not reuse the worktree folder soccer team as a new tab title', async () => {
    const { createChatTab } = await import('./chat-tabs.js');
    // Even if the sibling title is not a club name, the worktree dir / branch
    // still reserve "west-ham".
    const untitledSource: Thread = {
      ...source,
      id: 'untitled-source',
      title: 'Untitled',
    };
    listed = [untitledSource];

    const tab = createChatTab({ fromThreadId: untitledSource.id });
    expect(tab.title).not.toBe('West Ham');
    expect(teamNames.has(tab.title)).toBe(true);
  });

  it('keeps Global orchestration tabs as orchestration (not demoted to branch)', async () => {
    const { createChatTab } = await import('./chat-tabs.js');
    const globalSource: Thread = {
      ...source,
      id: 'global-orch',
      title: 'Cloud-connected Sideboard orchestrator',
      sourceType: 'orchestration',
      sourceRef: 'Cloud-connected Sideboard orchestrator',
      branchName: 'global',
      worktreePath: '/tmp/sideboard-global',
      repoPath: '__global__',
    };
    listed = [globalSource];
    const tab = createChatTab({ fromThreadId: globalSource.id, title: 'Planning' });
    expect(tab.sourceType).toBe('orchestration');
    expect(tab.repoPath).toBe('__global__');
  });

  it('does not copy Slack inbound identity onto a sibling Global tab', async () => {
    const { createChatTab } = await import('./chat-tabs.js');
    const slack: Thread = {
      ...source,
      id: 'slack-orch',
      title: 'Dundee',
      sourceType: 'orchestration',
      sourceRef: 'slack:T1:Umatt',
      branchName: 'global',
      worktreePath: '/tmp/sideboard-global',
      repoPath: '__global__',
    };
    listed = [slack];
    const tab = createChatTab({ fromThreadId: slack.id, title: 'Planning' });
    expect(tab.sourceRef).toBe('Planning');
    expect(tab.sourceRef).not.toMatch(/^slack:/);
  });
});
