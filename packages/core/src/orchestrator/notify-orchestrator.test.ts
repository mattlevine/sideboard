import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandCanonicalGitRequest } from '../git/agent-git-actions.js';
import { createEmptyThread, writeThread } from '../store/thread-store.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import {
  formatAskUserNotifyMessage,
  formatNotifyOrchestratorPrompt,
  notifyOrchestrator,
  resetNotifyOrchestratorForTests,
  resolveNotifyCallerThread,
  shouldNotifyOrchestrator,
  SIDEBOARD_THREAD_ID_ENV,
} from './notify-orchestrator.js';

describe('notify_orchestrator', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-notify-orch-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    resetNotifyOrchestratorForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function orchParent() {
    const parent = createEmptyThread({
      title: 'San Carlos',
      sourceType: 'orchestration',
      sourceRef: 'Coordinate',
      branchName: 'global',
      worktreePath: join(dataDir, 'global'),
      repoPath: GLOBAL_WORKSPACE_ID,
      agent: 'claude',
    });
    writeThread(parent);
    mkdirSync(join(dataDir, 'wt'), { recursive: true });
    const child = createEmptyThread({
      title: 'Fix panel',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/limon',
      worktreePath: join(dataDir, 'wt'),
      repoPath: join(dataDir, 'repo'),
      agent: 'cursor',
      parentThreadId: parent.id,
    });
    writeThread(child);
    return { parent, child };
  }

  it('notifies an orchestration parent and queues (never steers)', async () => {
    const { parent, child } = orchParent();
    const sends: Array<{ id: string; prompt: string; opts: { followUp: 'queue' } }> =
      [];
    const result = await notifyOrchestrator({
      child,
      reason: 'blocked',
      message: 'Waiting on VPN.',
      send: async (id, prompt, opts) => {
        sends.push({ id, prompt, opts });
      },
    });
    expect(result).toEqual({ ok: true, parentThreadId: parent.id });
    expect(sends).toHaveLength(1);
    expect(sends[0]!.id).toBe(parent.id);
    expect(sends[0]!.opts).toEqual({ followUp: 'queue' });
    expect(sends[0]!.prompt).toContain('sideboard://chat/');
    expect(sends[0]!.prompt).toContain('is blocked');
    expect(sends[0]!.prompt).toContain('Waiting on VPN.');
    expect(sends[0]!.prompt).toContain('not a user command');
    expect(expandCanonicalGitRequest(sends[0]!.prompt)).toBe(sends[0]!.prompt);
  });

  it('dedupes input-required so ask_user plus an explicit call do not double-wake', async () => {
    const { child } = orchParent();
    const sends: string[] = [];
    const send = async (_id: string, prompt: string, _opts: { followUp: 'queue' }) => {
      sends.push(prompt);
    };
    const first = await notifyOrchestrator({
      child,
      reason: 'input-required',
      message: 'Asked the user: Keep Fast?',
      send,
    });
    const second = await notifyOrchestrator({
      child,
      reason: 'input-required',
      message: 'Asked the user: Keep Fast?',
      send,
    });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, deduped: true });
    expect(sends).toHaveLength(1);
  });

  it('skips worktree parents and missing parentThreadId', async () => {
    const worktreeParent = createEmptyThread({
      title: 'Not orch',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/x',
      worktreePath: join(dataDir, 'p'),
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
    });
    writeThread(worktreeParent);
    const child = createEmptyThread({
      title: 'Kid',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/y',
      worktreePath: join(dataDir, 'c'),
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      parentThreadId: worktreeParent.id,
    });
    expect(shouldNotifyOrchestrator({ child, parent: worktreeParent })).toBe(false);
    const result = await notifyOrchestrator({
      child,
      reason: 'blocked',
      message: 'hi',
      send: async () => {
        throw new Error('should not send');
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a Global orchestration chat/);
  });

  it('resolves the caller from SIDEBOARD_THREAD_ID', () => {
    const { child } = orchParent();
    const found = resolveNotifyCallerThread({
      env: { [SIDEBOARD_THREAD_ID_ENV]: child.id },
      cwd: '/no/such/cwd',
    });
    expect(found.id).toBe(child.id);
  });

  it('formats ask_user questions without dumping options', () => {
    expect(
      formatAskUserNotifyMessage([
        { question: 'Keep Fast?' },
        { question: 'Use cookies or tokens?' },
      ]),
    ).toBe('Asked the user: Keep Fast?; Use cookies or tokens?');
  });

  it('formats input-required as a non-git prompt', () => {
    const prompt = formatNotifyOrchestratorPrompt({
      child: { id: 'abc', title: 'Fix panel' },
      reason: 'input-required',
      message: 'Asked the user: Keep Fast?',
    });
    expect(prompt).toContain('input-required');
    expect(prompt).toContain('[Fix panel](sideboard://chat/abc)');
    expect(expandCanonicalGitRequest(prompt)).toBe(prompt);
  });
});
