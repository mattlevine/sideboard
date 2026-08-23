import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearStaleIndexLock, clearStaleIndexLocks, isIndexLockError } from './stale-lock.js';

describe('isIndexLockError', () => {
  it('matches git\'s stale lock failure', () => {
    expect(
      isIndexLockError(
        "fatal: Unable to create '/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository.",
      ),
    ).toBe(true);
  });

  it('matches a linked worktree index.lock path', () => {
    expect(
      isIndexLockError(
        "fatal: Unable to create '/repo/.git/worktrees/thing/index.lock': File exists.",
      ),
    ).toBe(true);
  });

  it('ignores unrelated git failures', () => {
    expect(isIndexLockError('fatal: not a git repository')).toBe(false);
  });
});

describe('clearStaleIndexLock', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sideboard-lock-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes a lock older than the threshold', () => {
    const lockPath = join(dir, 'index.lock');
    writeFileSync(lockPath, '');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);

    const removed = clearStaleIndexLock(dir, 20_000);
    expect(removed).toBe(lockPath);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('leaves a fresh lock alone', () => {
    const lockPath = join(dir, 'index.lock');
    writeFileSync(lockPath, '');

    const removed = clearStaleIndexLock(dir, 20_000);
    expect(removed).toBeNull();
    expect(existsSync(lockPath)).toBe(true);
  });

  it('is a no-op when there is no lock', () => {
    expect(clearStaleIndexLock(dir, 20_000)).toBeNull();
  });
});

describe('clearStaleIndexLocks', () => {
  it('sweeps multiple gitdirs and dedupes', () => {
    const dirA = mkdtempSync(join(tmpdir(), 'sideboard-lock-test-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'sideboard-lock-test-b-'));
    try {
      const lockA = join(dirA, 'index.lock');
      const lockB = join(dirB, 'index.lock');
      writeFileSync(lockA, '');
      writeFileSync(lockB, '');
      const old = new Date(Date.now() - 60_000);
      utimesSync(lockA, old, old);
      utimesSync(lockB, old, old);

      const removed = clearStaleIndexLocks([dirA, dirB, dirA], 20_000);
      expect(removed.sort()).toEqual([lockA, lockB].sort());
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});
