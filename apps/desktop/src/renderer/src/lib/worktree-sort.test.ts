import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isWorktreeSortMode,
  readWorktreeSort,
  writeWorktreeSort,
} from './worktree-sort';

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    configurable: true,
  });
}

describe('worktree sort preference', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    localStorage.removeItem('sideboard.worktreeSort');
  });

  it('defaults to created so running agents do not reshuffle the list', () => {
    expect(readWorktreeSort()).toBe('created');
    expect(isWorktreeSortMode('activity')).toBe(true);
    expect(isWorktreeSortMode('updatedAt')).toBe(false);
  });

  it('persists a valid mode', () => {
    writeWorktreeSort('name');
    expect(readWorktreeSort()).toBe('name');
  });
});
