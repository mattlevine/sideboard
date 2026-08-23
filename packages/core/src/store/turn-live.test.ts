import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessagePart } from '../types/thread.js';
import {
  summarizeTurnLive,
  noteTurnLiveEvent,
  readTurnLive,
  clearTurnLive,
} from './turn-live.js';
import {
  createEmptyThread,
  findThreadByRef,
  listThreads,
  writeThread,
} from './thread-store.js';
import { threadsSharingWorktree } from '../threads/chat-tabs.js';

describe('summarizeTurnLive', () => {
  it('summarizes a running tool', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: '1',
        name: 'Read',
        description: 'Read foo.ts',
        status: 'running',
      },
    ];
    const live = summarizeTurnLive(parts);
    expect(live.summary).toMatch(/Read foo\.ts/);
    expect(live.toolCount).toBe(1);
    expect(live.lastTool).toBe('Read foo.ts');
  });

  it('says thinking when there are no tools yet', () => {
    const live = summarizeTurnLive([{ type: 'thinking', text: 'plan the review' }]);
    expect(live.summary).toMatch(/plan the review/);
    expect(live.excerpt).toMatch(/plan the review/);
  });
});

describe('noteTurnLiveEvent', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-live-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('writes a sidecar on tool_use so MCP can read progress', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    noteTurnLiveEvent(id, {
      type: 'tool_use',
      id: 't1',
      name: 'Read',
      input: { path: 'foo.ts' },
    });
    const live = readTurnLive(id);
    expect(live?.summary).toMatch(/foo\.ts/);
    expect(live?.toolCount).toBe(1);
    clearTurnLive(id);
  });

  it('does not treat the sidecar as a thread record', () => {
    const thread = createEmptyThread({
      title: 'Odd',
      sourceType: 'orchestration',
      sourceRef: 'slack:T1:U1',
      branchName: 'main',
      worktreePath: join(dataDir, 'global'),
      repoPath: '__global__',
      agent: 'cursor',
      status: 'running',
    });
    writeThread(thread);
    noteTurnLiveEvent(thread.id, {
      type: 'tool_use',
      id: 't1',
      name: 'mcp__sideboard__get_thread',
      input: { ref: thread.id },
    });

    expect(listThreads().map((t) => t.id)).toEqual([thread.id]);
    expect(findThreadByRef(thread.id)?.id).toBe(thread.id);
    expect(() => threadsSharingWorktree(thread.worktreePath)).not.toThrow();
    expect(threadsSharingWorktree(thread.worktreePath).map((t) => t.id)).toEqual([
      thread.id,
    ]);
    clearTurnLive(thread.id);
  });
});
