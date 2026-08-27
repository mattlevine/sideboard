import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEmptyThread,
  invalidateThreadListCache,
  isThreadRecordFile,
  listThreads,
  writeThread,
} from './thread-store.js';

describe('isThreadRecordFile', () => {
  it('accepts thread records and rejects live sidecars and tmp writes', () => {
    expect(isThreadRecordFile('abc.json')).toBe(true);
    expect(isThreadRecordFile('/data/threads/abc.json')).toBe(true);
    expect(isThreadRecordFile('abc.live.json')).toBe(false);
    expect(isThreadRecordFile('/data/threads/abc.live.json')).toBe(false);
    expect(isThreadRecordFile('abc.live.json.12.tmp')).toBe(false);
    expect(isThreadRecordFile('abc.json.12.tmp')).toBe(false);
  });
});

describe('thread list cache', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-thread-cache-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    invalidateThreadListCache();
  });

  afterEach(() => {
    invalidateThreadListCache();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns write-through updates without a second disk hydrate', () => {
    const first = createEmptyThread({
      title: 'one',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/one',
      worktreePath: '/tmp/one',
      repoPath: '/tmp/repo',
      agent: 'claude',
    });
    writeThread(first);
    expect(listThreads().map((t) => t.id)).toEqual([first.id]);

    const second = createEmptyThread({
      title: 'two',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/two',
      worktreePath: '/tmp/two',
      repoPath: '/tmp/repo',
      agent: 'claude',
    });
    writeThread(second);
    expect(listThreads().map((t) => t.id).sort()).toEqual([first.id, second.id].sort());
  });
});
