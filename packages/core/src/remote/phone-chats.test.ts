import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateDefaultsSettings, updateProjectProfileSettings } from '../store/app-settings.js';
import { removeWorkspace } from '../store/workspaces.js';
import { clearTurnLive, noteTurnLiveEvent } from '../store/turn-live.js';
import { createEmptyThread, updateThread, writeThread } from '../store/thread-store.js';

const createThread = vi.hoisted(() => vi.fn());
vi.mock('../threads/create.js', () => ({ createThread }));

import {
  archivePhoneChat,
  createPhoneChat,
  createPhoneProjectWorktree,
  createPhoneWorktreeAgent,
  encodePhoneControl,
  findPhoneChat,
  listPhoneHistory,
  listPhoneSidebar,
  openPhoneChat,
  takePhoneControl,
} from './phone-chats.js';

describe('phone orchestration chats', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-phone-chats-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('ignores ordinary prompts and rejects a broken control body', () => {
    expect(takePhoneControl('ship the fix')).toBeNull();
    expect(takePhoneControl(encodePhoneControl({ op: 'list' }))).toEqual({ op: 'list' });
    expect(takePhoneControl(encodePhoneControl({ op: 'history' }))).toEqual({ op: 'history' });
    expect(takePhoneControl(encodePhoneControl({ op: 'history', query: 'ajax', after: 'cursor' }))).toEqual({
      op: 'history',
      query: 'ajax',
      after: 'cursor',
    });
    expect(takePhoneControl(encodePhoneControl({ op: 'restore', chatId: 'chat-1' }))).toEqual({
      op: 'restore',
      chatId: 'chat-1',
    });
    expect(takePhoneControl(encodePhoneControl({ op: 'header', chatId: 'chat-1' }))).toEqual({
      op: 'header',
      chatId: 'chat-1',
    });
    expect(takePhoneControl(encodePhoneControl({ op: 'git', chatId: 'chat-1', action: 'commit-push' }))).toEqual({
      op: 'git',
      chatId: 'chat-1',
      action: 'commit-push',
    });
    expect(takePhoneControl('\u0000sb.phone\n{"op":"git","chatId":"chat-1","action":"rebase"}')).toBe('invalid');
    expect(
      takePhoneControl(encodePhoneControl({ op: 'pane', chatId: 'chat-1', pane: 'changes', scope: 'uncommitted' })),
    ).toEqual({ op: 'pane', chatId: 'chat-1', pane: 'changes', scope: 'uncommitted' });
    expect(
      takePhoneControl(encodePhoneControl({ op: 'open-file', chatId: 'chat-1', path: 'apps/mobile/App.tsx', startLine: 12 })),
    ).toEqual({ op: 'open-file', chatId: 'chat-1', path: 'apps/mobile/App.tsx', startLine: 12 });
    expect(
      takePhoneControl(encodePhoneControl({ op: 'open-file', chatId: 'chat-1', path: 'a.ts', view: 'diff' })),
    ).toEqual({ op: 'open-file', chatId: 'chat-1', path: 'a.ts', view: 'diff' });
    expect(
      takePhoneControl(
        encodePhoneControl({
          op: 'open-file',
          chatId: 'chat-1',
          path: 'a.ts',
          view: 'diff',
          scope: 'uncommitted',
          commitSha: 'abc1234',
        }),
      ),
    ).toEqual({ op: 'open-file', chatId: 'chat-1', path: 'a.ts', view: 'diff', scope: 'uncommitted' });
    expect(
      takePhoneControl(
        encodePhoneControl({
          op: 'open-file',
          chatId: 'chat-1',
          path: 'a.ts',
          view: 'diff',
          scope: 'commits',
          commitSha: 'abc1234',
        }),
      ),
    ).toEqual({
      op: 'open-file',
      chatId: 'chat-1',
      path: 'a.ts',
      view: 'diff',
      scope: 'commits',
      commitSha: 'abc1234',
    });
    expect(
      takePhoneControl(encodePhoneControl({ op: 'open-artifact', chatId: 'chat-1', title: 'Dashboard', hint: '<p>' })),
    ).toEqual({ op: 'open-artifact', chatId: 'chat-1', title: 'Dashboard', hint: '<p>' });
    expect(takePhoneControl(encodePhoneControl({ op: 'media', chatId: 'chat-1', path: 'shot.png' }))).toEqual({
      op: 'media',
      chatId: 'chat-1',
      path: 'shot.png',
    });
    expect(takePhoneControl(encodePhoneControl({ op: 'create', where: 'orchestration' }))).toEqual({
      op: 'create',
      where: 'orchestration',
    });
    expect(takePhoneControl('\u0000sb.phone\n{"op":"create"}')).toEqual({
      op: 'create',
      where: 'orchestration',
    });
    expect(
      takePhoneControl(encodePhoneControl({ op: 'create', where: 'worktree', chatId: 'chat-1' })),
    ).toEqual({ op: 'create', where: 'worktree', chatId: 'chat-1' });
    expect(
      takePhoneControl(encodePhoneControl({ op: 'create', where: 'project', repoPath: '/tmp/sideboard' })),
    ).toEqual({ op: 'create', where: 'project', repoPath: '/tmp/sideboard' });
    expect(takePhoneControl(encodePhoneControl({ op: 'create', where: 'project', repoPath: '/' }))).toBe(
      'invalid',
    );
    expect(takePhoneControl('\u0000sb.phone\n{')).toBe('invalid');
    expect(
      takePhoneControl(
        encodePhoneControl({
          op: 'prompt',
          chatId: 'chat-1',
          text: 'look',
          files: [{ name: 'shot.jpg', dataBase64: 'aGVsbG8=' }],
          planMode: true,
        }),
      ),
    ).toEqual({
      op: 'prompt',
      chatId: 'chat-1',
      text: 'look',
      files: [{ name: 'shot.jpg', dataBase64: 'aGVsbG8=' }],
      planMode: true,
    });
    expect(
      takePhoneControl(
        encodePhoneControl({
          op: 'create',
          where: 'project',
          repoPath: '/tmp/sideboard',
          sourceType: 'pr',
          sourceRef: '42',
          title: 'Fix the board',
        }),
      ),
    ).toMatchObject({
      op: 'create',
      where: 'project',
      repoPath: '/tmp/sideboard',
      sourceType: 'pr',
      sourceRef: '42',
      title: 'Fix the board',
    });
    expect(takePhoneControl(encodePhoneControl({ op: 'prompt', chatId: 'chat-1', text: '' }))).toBe(
      'invalid',
    );
    expect(
      takePhoneControl(
        encodePhoneControl({
          op: 'prompt',
          chatId: 'chat-1',
          text: '',
          refs: [{ path: 'apps/mobile/App.tsx', startLine: 10, endLine: 12, text: 'const n = 1' }],
        }),
      ),
    ).toMatchObject({
      op: 'prompt',
      text: '',
      refs: [{ path: 'apps/mobile/App.tsx', startLine: 10, endLine: 12, text: 'const n = 1' }],
    });
  });

  it('creates, lists, opens, and archives a global orchestration chat', () => {
    const created = createPhoneChat('claude');
    updateThread(created.chat.id, {
      messages: [
        { role: 'user', text: 'Phone\n\ncheck the board', ts: new Date().toISOString() },
        { role: 'agent', text: 'Two agents are running.', ts: new Date().toISOString() },
      ],
    });

    const listed = listPhoneSidebar();
    expect(listed.orchestration.map((chat) => chat.id)).toContain(created.chat.id);
    expect(listed.orchestration.find((chat) => chat.id === created.chat.id)).toMatchObject({
      preview: 'Two agents are running.',
      agent: 'claude',
    });

    const opened = openPhoneChat(created.chat.id);
    expect(opened?.messages).toEqual([
      { role: 'user', text: 'check the board' },
      { role: 'agent', text: 'Two agents are running.' },
    ]);

    updateThread(created.chat.id, { status: 'running' });
    noteTurnLiveEvent(created.chat.id, { type: 'stdout', data: 'Still writing the latest reply' });
    expect(openPhoneChat(created.chat.id)?.messages).toEqual([
      { role: 'user', text: 'check the board' },
      { role: 'agent', text: 'Two agents are running.' },
      { role: 'agent', text: 'Still writing the latest reply', streaming: true },
    ]);
    clearTurnLive(created.chat.id);
    expect(openPhoneChat(created.chat.id.slice(0, 8))?.chat.id).toBe(created.chat.id);

    expect(archivePhoneChat(created.chat.id)).toBe(true);
    expect(listPhoneSidebar().orchestration.some((chat) => chat.id === created.chat.id)).toBe(false);
    expect(openPhoneChat(created.chat.id)).toBeNull();
    expect(findPhoneChat(created.chat.id.slice(0, 8))?.id).toBe(created.chat.id);
    const history = listPhoneHistory();
    expect(history.chats.map((chat) => chat.id)).toEqual([created.chat.id]);
    expect(history.total).toBe(1);
    expect(history.next).toBeUndefined();
    expect(history.chats[0]).toMatchObject({ where: 'Orchestration', agent: 'claude', title: created.chat.title });
  });

  it('lists project worktrees beside orchestration', () => {
    const thread = createEmptyThread({
      title: 'ajax',
      sourceType: 'branch',
      sourceRef: 'ajax',
      branchName: 'thread/ajax',
      worktreePath: '/tmp/sideboard-ajax',
      repoPath: '/tmp/sideboard',
      agent: 'claude',
    });
    writeThread(thread);
    const sidebar = listPhoneSidebar();
    expect(sidebar.projects.map((project) => project.name)).toContain('sideboard');
    const project = sidebar.projects.find((row) => row.path === '/tmp/sideboard');
    expect(project?.worktrees[0]?.chats.map((chat) => chat.id)).toEqual([thread.id]);
    expect(project?.worktrees[0]?.chats[0]?.agent).toBe('claude');
    updateThread(thread.id, {
      agentBlock: { reason: 'Allow the edit?', source: 'permission', at: '2026-10-17T00:00:00.000Z' },
    });
    expect(
      listPhoneSidebar().projects.find((row) => row.path === '/tmp/sideboard')?.worktrees[0]?.chats[0],
    ).toMatchObject({ needsYou: true, blockedReason: 'Allow the edit?' });
    updateThread(thread.id, {
      status: 'running',
      agentBlock: {
        reason: 'Asked the user: Which API?',
        source: 'ask_user',
        at: '2026-10-17T00:00:01.000Z',
      },
    });
    expect(
      listPhoneSidebar().projects.find((row) => row.path === '/tmp/sideboard')?.worktrees[0]?.chats[0]
        ?.needsYou,
    ).toBeUndefined();
    updateThread(thread.id, { status: 'idle' });
    expect(
      listPhoneSidebar().projects.find((row) => row.path === '/tmp/sideboard')?.worktrees[0]?.chats[0],
    ).toMatchObject({ needsYou: true, blockedReason: 'Asked the user: Which API?' });
    updateThread(thread.id, { tags: ['phone-sync'] });
    expect(listPhoneSidebar().projects.find((row) => row.path === '/tmp/sideboard')?.worktrees[0]?.tags).toEqual([
      'phone-sync',
    ]);
    updateThread(thread.id, { issueBlockedBy: ['ENG-88', 'eng-88', ' ENG-91 '] });
    expect(
      listPhoneSidebar().projects.find((row) => row.path === '/tmp/sideboard')?.worktrees[0]?.blockedBy,
    ).toEqual(['ENG-88', 'ENG-91']);
    updateThread(thread.id, { issueBlockedBy: [] });
    expect(
      listPhoneSidebar().projects.find((row) => row.path === '/tmp/sideboard')?.worktrees[0]?.blockedBy,
    ).toBeUndefined();
    expect(openPhoneChat(thread.id)?.chat.id).toBe(thread.id);
    expect(archivePhoneChat(thread.id)).toBe(true);
    expect(listPhoneHistory().chats[0]).toMatchObject({
      id: thread.id,
      where: 'sideboard',
      agent: 'claude',
      workspace: 'sideboard-ajax',
    });
    expect(listPhoneSidebar().projects.some((row) => row.path === '/tmp/sideboard')).toBe(false);
  });

  it('sends review and pending labels for pull requests in review', () => {
    updateProjectProfileSettings('/tmp/sideboard', { reviewLabel: 'eng-review' });
    const mine = createEmptyThread({
      title: 'mine',
      sourceType: 'branch',
      sourceRef: 'mine',
      branchName: 'thread/mine',
      worktreePath: '/tmp/sideboard-mine',
      repoPath: '/tmp/sideboard',
      agent: 'claude',
      prUrl: 'https://github.com/acme/app/pull/4',
      prState: 'OPEN',
      prAuthorLogin: 'matt',
      prLabels: ['eng-review'],
      prMergeable: 'CONFLICTING',
      prChecksFailed: true,
    });
    const theirs = createEmptyThread({
      title: 'theirs',
      sourceType: 'pr',
      sourceRef: '5',
      branchName: 'thread/theirs',
      worktreePath: '/tmp/sideboard-theirs',
      repoPath: '/tmp/sideboard',
      agent: 'claude',
      prUrl: 'https://github.com/acme/app/pull/5',
      prState: 'OPEN',
      prAuthorLogin: 'sam',
    });
    const draft = createEmptyThread({
      title: 'draft',
      sourceType: 'branch',
      sourceRef: 'draft',
      branchName: 'thread/draft',
      worktreePath: '/tmp/sideboard-draft',
      repoPath: '/tmp/sideboard',
      agent: 'claude',
      prUrl: 'https://github.com/acme/app/pull/6',
      prState: 'OPEN',
      prIsDraft: true,
      prAuthorLogin: 'matt',
    });
    writeThread(mine);
    writeThread(theirs);
    writeThread(draft);

    const labeled = listPhoneSidebar('matt').projects.find((row) => row.path === '/tmp/sideboard');
    const badge = (id: string) =>
      labeled?.worktrees.find((worktree) => worktree.chats.some((chat) => chat.id === id))?.badge;
    expect(badge(mine.id)).toEqual({
      id: 'pending',
      label: 'pending',
      title: 'Waiting for review · checks failing · merge conflicts',
      conflict: true,
    });
    expect(badge(theirs.id)).toEqual({
      id: 'review',
      label: 'review',
      title: "Someone else's PR",
    });
    expect(badge(draft.id)).toEqual({
      id: 'draft',
      label: 'draft',
      title: 'Draft pull request',
    });
    const mineChat = labeled?.worktrees.flatMap((worktree) => worktree.chats).find((chat) => chat.id === mine.id);
    expect(mineChat).toMatchObject({
      prUrl: 'https://github.com/acme/app/pull/4',
      prNumber: '4',
      prStatus: 'Merge conflicts',
    });
    const unlabeled = listPhoneSidebar().projects.find((row) => row.path === '/tmp/sideboard');
    const quiet = (id: string) =>
      unlabeled?.worktrees.find((worktree) => worktree.chats.some((chat) => chat.id === id))?.badge;
    expect(quiet(mine.id)).toBeUndefined();
    expect(quiet(theirs.id)).toBeUndefined();
    expect(quiet(draft.id)).toBeUndefined();
  });

  it('adds an agent onto an existing project worktree', () => {
    const thread = createEmptyThread({
      title: 'ajax',
      sourceType: 'branch',
      sourceRef: 'ajax',
      branchName: 'thread/ajax',
      worktreePath: '/tmp/sideboard-ajax',
      repoPath: '/tmp/sideboard',
      agent: 'claude',
    });
    writeThread(thread);
    const created = createPhoneWorktreeAgent(thread.id);
    expect(created.place).toEqual({
      kind: 'project',
      repoPath: '/tmp/sideboard',
      worktree: 'Ajax',
    });
    const project = listPhoneSidebar().projects.find((row) => row.path === '/tmp/sideboard');
    expect(project?.worktrees).toHaveLength(1);
    expect(project?.worktrees[0]?.chats.map((chat) => chat.id).sort()).toEqual(
      [thread.id, created.chat.id].sort(),
    );
    expect(created.chat.id).not.toBe(thread.id);
  });

  it('creates a worktree agent in a registered project', async () => {
    writeFileSync(
      join(dataDir, 'workspaces.json'),
      JSON.stringify([{ path: '/tmp/sideboard', name: 'sideboard', addedAt: new Date().toISOString() }]),
    );
    createThread.mockImplementation(async (input: { repoPath: string; agent: 'claude' }) => {
      const thread = createEmptyThread({
        title: 'monaco',
        sourceType: 'branch',
        sourceRef: 'main',
        branchName: 'thread/monaco',
        worktreePath: '/tmp/sideboard-monaco',
        repoPath: input.repoPath,
        agent: input.agent,
      });
      writeThread(thread);
      return thread;
    });
    const created = await createPhoneProjectWorktree('/tmp/sideboard');
    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'branch',
        sourceRef: 'default',
        repoPath: '/tmp/sideboard',
        reuseExisting: false,
      }),
    );
    expect(created.place?.kind).toBe('project');
    const project = listPhoneSidebar().projects.find((row) => row.path === '/tmp/sideboard');
    expect(project?.worktrees[0]?.chats.map((chat) => chat.id)).toEqual([created.chat.id]);
  });

  it('uses the account orchestration and worktree agent defaults', async () => {
    updateDefaultsSettings({
      agent: 'codex',
      model: 'gpt-5',
      effort: 'low',
      orchestrator: { agent: 'cursor', model: 'default', effort: 'high' },
    });
    const sidebar = listPhoneSidebar();
    expect(sidebar.defaults?.worktree).toMatchObject({
      agent: 'codex',
      model: 'gpt-5',
      effort: 'low',
    });
    expect(sidebar.defaults?.orchestration).toMatchObject({
      agent: 'cursor',
      model: 'default',
      effort: 'high',
    });
    expect(createPhoneChat().chat.agent).toBe('cursor');

    writeFileSync(
      join(dataDir, 'workspaces.json'),
      JSON.stringify([{ path: '/tmp/sideboard', name: 'sideboard', addedAt: new Date().toISOString() }]),
    );
    createThread.mockImplementation(async (input: { repoPath: string; agent: string }) => {
      const thread = createEmptyThread({
        title: 'monaco',
        sourceType: 'branch',
        sourceRef: 'main',
        branchName: 'thread/monaco',
        worktreePath: '/tmp/sideboard-monaco',
        repoPath: input.repoPath,
        agent: input.agent as 'codex',
      });
      writeThread(thread);
      return thread;
    });
    await createPhoneProjectWorktree('/tmp/sideboard');
    expect(createThread).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex' }));
  });

  it('hides a removed project until it is registered again', () => {
    const thread = createEmptyThread({
      title: 'ajax',
      sourceType: 'branch',
      sourceRef: 'ajax',
      branchName: 'thread/ajax',
      worktreePath: '/tmp/sideboard-ajax',
      repoPath: '/tmp/sideboard',
      agent: 'claude',
    });
    writeThread(thread);
    removeWorkspace('/tmp/sideboard');
    expect(listPhoneSidebar().projects.some((row) => row.path === '/tmp/sideboard')).toBe(false);
  });

  it('pages a long archive and filters before paging', () => {
    for (let i = 0; i < 41; i += 1) {
      const thread = createEmptyThread({
        title: i === 7 ? 'needle in the archive' : `chat-${i}`,
        sourceType: 'branch',
        sourceRef: 'main',
        branchName: `thread/chat-${i}`,
        worktreePath: `/tmp/archive-${i}`,
        repoPath: '__global__',
        agent: 'claude',
      });
      writeThread(thread);
      updateThread(thread.id, {
        status: 'archived',
        archivedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      });
    }

    const first = listPhoneHistory();
    expect(first.total).toBe(41);
    expect(first.chats).toHaveLength(40);
    expect(first.next).toBeTruthy();
    expect(first.chats[0]?.title).toBe('chat-40');

    const second = listPhoneHistory({ after: first.next });
    expect(second.chats).toHaveLength(1);
    expect(second.total).toBe(41);
    expect(second.next).toBeUndefined();
    expect(second.chats[0]?.title).toBe('chat-0');
    expect(first.chats.map((chat) => chat.id)).not.toContain(second.chats[0]?.id);

    const found = listPhoneHistory({ query: 'Needle' });
    expect(found.total).toBe(1);
    expect(found.chats.map((chat) => chat.title)).toEqual(['needle in the archive']);
    expect(found.next).toBeUndefined();
  });
});
