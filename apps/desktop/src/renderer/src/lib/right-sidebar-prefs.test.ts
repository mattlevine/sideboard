import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readRightSidebarOpen,
  readRightSidebarWidth,
  RIGHT_SIDEBAR_WIDTH_FALLBACK,
  writeRightSidebarOpen,
  writeRightSidebarWidth,
} from './right-sidebar-prefs';

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
    writable: true,
  });
}

describe('right-sidebar-prefs', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults open, then remembers per worktree without cross-bleed', () => {
    expect(readRightSidebarOpen('/wt/monaco')).toBe(true);
    writeRightSidebarOpen('/wt/monaco', false);
    expect(readRightSidebarOpen('/wt/monaco')).toBe(false);
    expect(readRightSidebarOpen('/wt/cruzeiro')).toBe(true);
    writeRightSidebarOpen('/wt/cruzeiro/', true);
    expect(readRightSidebarOpen('/wt/monaco')).toBe(false);
    expect(readRightSidebarOpen('/wt/cruzeiro')).toBe(true);
  });

  it('remembers width per worktree without cross-bleed', () => {
    expect(readRightSidebarWidth('/wt/monaco')).toBe(RIGHT_SIDEBAR_WIDTH_FALLBACK);
    writeRightSidebarWidth('/wt/monaco', 400);
    expect(readRightSidebarWidth('/wt/monaco')).toBe(400);
    expect(readRightSidebarWidth('/wt/cruzeiro')).toBe(RIGHT_SIDEBAR_WIDTH_FALLBACK);
    writeRightSidebarWidth('/wt/cruzeiro', 500);
    expect(readRightSidebarWidth('/wt/monaco')).toBe(400);
    expect(readRightSidebarWidth('/wt/cruzeiro')).toBe(500);
  });

  it('falls back to legacy global key only when worktree is unset', () => {
    localStorage.setItem('sideboard.rightSidebar', '0');
    expect(readRightSidebarOpen(null)).toBe(false);
    writeRightSidebarOpen(null, true);
    expect(localStorage.getItem('sideboard.rightSidebar')).toBe('1');
    writeRightSidebarOpen('/wt/monaco', false);
    expect(localStorage.getItem('sideboard.rightSidebar')).toBe('1');
  });
});
