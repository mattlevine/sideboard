import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { getOrchestrator } from '../orchestrator/orchestrator.js';
import { updateAdvancedSettings } from '../store/app-settings.js';
import type { ResolveNewThreadOptions } from './create-thread-agent.js';
import { createOrchChildThread } from './create-orch-child.js';

const resolveNewThreadOptions: ResolveNewThreadOptions = () => ({
  agent: 'cursor',
  model: null,
  effort: 'high',
  fast: false,
  autonomy: 'full',
});

type ChildFixture = {
  id: string;
  parentThreadId: string;
  worktreePath?: string;
  sourceType?: 'branch' | 'orchestration';
  repoPath?: string;
};

function workspaceChildren(parentId: string, count: number): ChildFixture[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `child-${i}`,
    parentThreadId: parentId,
    worktreePath: `/tmp/wt-${i}`,
    sourceType: 'branch' as const,
    repoPath: '/tmp/repo',
  }));
}

function orchWithChildren(parentId: string, children: ChildFixture[]) {
  const createThread = vi.fn(async () => ({
    id: 'created',
    title: 'Created',
    branchName: 'matt/created',
    worktreePath: undefined,
    agent: 'cursor' as const,
    model: null,
    status: 'idle' as const,
    cowboy: false,
    parentThreadId: parentId,
    tags: [] as string[],
  }));
  const orch = {
    getThread(id: string) {
      if (id === parentId) return { id: parentId, agent: 'claude' as const, parentThreadId: null };
      return children.find((t) => t.id === id) ?? null;
    },
    getThreads() {
      return [...children, { id: 'unrelated', parentThreadId: 'someone-else' }];
    },
    createThread,
  };
  return {
    createThread,
    orch: orch as unknown as ReturnType<typeof getOrchestrator>,
  };
}

describe('createOrchChildThread cap', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
  });

  function isolateSettings() {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-orch-cap-'));
  }

  async function create(children: ChildFixture[]) {
    const parentId = 'parent-1';
    const { orch, createThread } = orchWithChildren(parentId, children);
    const result = await createOrchChildThread(
      orch,
      { sourceType: 'branch', sourceRef: 'main', repoPath: '/tmp/repo', parentChatId: parentId },
      resolveNewThreadOptions,
    );
    return { result, createThread };
  }

  it('blocks a sixth workspace at the default cap', async () => {
    isolateSettings();
    const { result, createThread } = await create(workspaceChildren('parent-1', 5));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.text).toContain('Workspace cap (5)');
    expect(createThread).not.toHaveBeenCalled();
  });

  it('uses the Advanced setting', async () => {
    isolateSettings();
    updateAdvancedSettings({ maxOrchThreads: 2 });
    const blocked = await create(workspaceChildren('parent-1', 2));
    expect(blocked.result.ok).toBe(false);
    if (!blocked.result.ok) {
      expect(blocked.result.text).toMatch(/Workspace cap \(2\).*Settings → Advanced/);
    }
    expect(blocked.createThread).not.toHaveBeenCalled();

    const allowed = await create(workspaceChildren('parent-1', 1));
    expect(allowed.result.ok).toBe(true);
    expect(allowed.createThread).toHaveBeenCalledOnce();
  });

  it('counts fork chats on one checkout as one workspace', async () => {
    isolateSettings();
    const children = [
      ...workspaceChildren('parent-1', 4),
      {
        id: 'fork-0',
        parentThreadId: 'parent-1',
        worktreePath: '/tmp/wt-0/',
        sourceType: 'branch' as const,
        repoPath: '/tmp/repo',
      },
    ];
    const { result, createThread } = await create(children);
    expect(result.ok).toBe(true);
    expect(createThread).toHaveBeenCalledOnce();
  });

  it('does not count orchestration-tab forks', async () => {
    isolateSettings();
    const forks = Array.from({ length: 5 }, (_, i) => ({
      id: `orch-fork-${i}`,
      parentThreadId: 'parent-1',
      worktreePath: '/tmp/sideboard-global',
      sourceType: 'orchestration' as const,
      repoPath: '__global__',
    }));
    const { result, createThread } = await create(forks);
    expect(result.ok).toBe(true);
    expect(createThread).toHaveBeenCalledOnce();
  });
});
