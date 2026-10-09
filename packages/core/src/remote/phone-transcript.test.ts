import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyThread, writeThread } from '../store/thread-store.js';
import { clearTurnLive, noteTurnLiveEvent } from '../store/turn-live.js';
import { listPhoneMessages } from './phone-transcript.js';

describe('listPhoneMessages', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-phone-transcript-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('keeps the in-progress reply ahead of queued prompts', () => {
    const thread = createEmptyThread({
      title: 'Phone',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/phone',
      worktreePath: join(dataDir, 'wt'),
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
    });
    const saved = {
      ...thread,
      status: 'running' as const,
      messages: [{ role: 'user' as const, text: 'Phone\n\nship it', ts: thread.createdAt }],
      queue: ['follow up'],
    };
    writeThread(saved);
    noteTurnLiveEvent(thread.id, { type: 'stdout', data: 'working on it' });
    const live = listPhoneMessages(saved);
    clearTurnLive(thread.id);
    expect(live.map((row) => row.text)).toEqual(['ship it', 'working on it', 'follow up']);
    expect(live[1]?.streaming).toBe(true);
  });
});
