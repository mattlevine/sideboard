import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HISTORY_DISCARDED_TEXT } from './history-retention.js';
import {
  createEmptyThread,
  invalidateThreadListCache,
  listThreads,
  readThread,
  writeThread,
} from './thread-store.js';
import { cleanupArchivedHistory } from './history-cleanup.js';

describe('cleanupArchivedHistory', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-history-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    vi.stubEnv('HOME', dataDir);
    invalidateThreadListCache();
  });

  afterEach(() => {
    invalidateThreadListCache();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seedArchived(id: string, updatedAt: string, fat = true) {
    const thread = createEmptyThread({
      title: id,
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: `thread/${id}`,
      worktreePath: `/tmp/${id}`,
      repoPath: '/tmp/repo',
      agent: 'claude',
      status: 'archived',
    });
    thread.id = id;
    thread.updatedAt = updatedAt;
    thread.messages = fat
      ? [
          {
            role: 'user',
            text: 'huge',
            ts: updatedAt,
            parts: [{ type: 'text', text: 'huge' }],
          },
        ]
      : [{ role: 'summary', text: HISTORY_DISCARDED_TEXT, ts: updatedAt }];
    writeThread(thread, { touch: false });
    return thread;
  }

  it('strips overflow then purges an existing stub; leaves live chats', () => {
    seedArchived('old-fat', '2026-01-01T00:00:00.000Z', true);
    seedArchived('old-stub', '2026-01-02T00:00:00.000Z', false);
    seedArchived('keep-a', '2026-02-01T00:00:00.000Z', true);
    seedArchived('keep-b', '2026-03-01T00:00:00.000Z', true);
    const live = createEmptyThread({
      title: 'live',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/live',
      worktreePath: '/tmp/live',
      repoPath: '/tmp/repo',
      agent: 'claude',
    });
    writeThread(live, { touch: false });

    const result = cleanupArchivedHistory({
      force: true,
      maxCount: 2,
      maxDays: 0,
    });

    expect(result.stripped).toEqual(['old-fat']);
    expect(result.purged).toEqual(['old-stub']);
    expect(readThread('old-fat')?.messages[0]?.text).toBe(HISTORY_DISCARDED_TEXT);
    expect(readThread('old-fat')?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(readThread('old-stub')).toBeNull();
    expect(readThread(live.id)?.status).toBe('idle');
    expect(listThreads({ includeArchived: true })).toHaveLength(4);
  });

  it('manual clear older than purges without stripping', () => {
    seedArchived('old', '2026-01-01T00:00:00.000Z', true);
    seedArchived('new', '2026-03-01T00:00:00.000Z', true);

    const result = cleanupArchivedHistory({
      purgeOlderThanDays: 30,
      nowMs: Date.parse('2026-03-15T00:00:00.000Z'),
    });

    expect(result.stripped).toEqual([]);
    expect(result.purged).toEqual(['old']);
    expect(readThread('old')).toBeNull();
    expect(readThread('new')).not.toBeNull();
  });

  it('no-ops when the History cap is turned off', () => {
    writeFileSync(
      join(dataDir, 'settings.json'),
      JSON.stringify({ advanced: { autoCleanupHistory: false } }),
      'utf8',
    );
    seedArchived('old', '2026-01-01T00:00:00.000Z', true);
    const result = cleanupArchivedHistory({ maxCount: 1 });
    expect(result).toEqual({ stripped: [], purged: [] });
    expect(readThread('old')).not.toBeNull();
  });
});
