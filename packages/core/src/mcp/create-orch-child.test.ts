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

function orchWithChildren(parentId: string, count: number) {
  const children = Array.from({ length: count }, (_, i) => ({
    id: `child-${i}`,
    parentThreadId: parentId,
  }));
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

  async function create(childCount: number) {
    const parentId = 'parent-1';
    const { orch, createThread } = orchWithChildren(parentId, childCount);
    const result = await createOrchChildThread(
      orch,
      { sourceType: 'branch', sourceRef: 'main', repoPath: '/tmp/repo', parentChatId: parentId },
      resolveNewThreadOptions,
    );
    return { result, createThread };
  }

  it('blocks a sixth child at the default cap', async () => {
    isolateSettings();
    const { result, createThread } = await create(5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.text).toContain('Thread-creation cap (5)');
    expect(createThread).not.toHaveBeenCalled();
  });

  it('uses the Advanced setting', async () => {
    isolateSettings();
    updateAdvancedSettings({ maxOrchThreads: 2 });
    const blocked = await create(2);
    expect(blocked.result.ok).toBe(false);
    if (!blocked.result.ok) {
      expect(blocked.result.text).toMatch(/Thread-creation cap \(2\).*Settings → Advanced/);
    }
    expect(blocked.createThread).not.toHaveBeenCalled();

    const allowed = await create(1);
    expect(allowed.result.ok).toBe(true);
    expect(allowed.createThread).toHaveBeenCalledOnce();
  });
});
