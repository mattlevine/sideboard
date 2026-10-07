import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyThread, updateThread, writeThread } from '../store/thread-store.js';

const createThread = vi.hoisted(() => vi.fn());
vi.mock('../threads/create.js', () => ({ createThread }));

import {
  archivePhoneChat,
  createPhoneChat,
  createPhoneProjectWorktree,
  createPhoneWorktreeAgent,
  encodePhoneControl,
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
    expect(listed.orchestration.find((chat) => chat.id === created.chat.id)?.preview).toBe(
      'Two agents are running.',
    );

    const opened = openPhoneChat(created.chat.id);
    expect(opened?.messages).toEqual([
      { role: 'user', text: 'check the board' },
      { role: 'agent', text: 'Two agents are running.' },
    ]);

    expect(archivePhoneChat(created.chat.id)).toBe(true);
    expect(listPhoneSidebar().orchestration.some((chat) => chat.id === created.chat.id)).toBe(false);
    expect(openPhoneChat(created.chat.id)).toBeNull();
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
    expect(openPhoneChat(thread.id)?.chat.id).toBe(thread.id);
    expect(archivePhoneChat(thread.id)).toBe(true);
    expect(listPhoneHistory().chats[0]).toMatchObject({ id: thread.id, where: 'sideboard', agent: 'claude' });
    expect(listPhoneSidebar().projects.some((row) => row.path === '/tmp/sideboard')).toBe(false);
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
