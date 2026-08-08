import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRightSidebarOpen, writeRightSidebarOpen } from './right-sidebar-prefs';

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

  it('defaults open, then remembers per workspace', () => {
    expect(readRightSidebarOpen('/repos/a')).toBe(true);
    writeRightSidebarOpen('/repos/a', false);
    expect(readRightSidebarOpen('/repos/a')).toBe(false);
    expect(readRightSidebarOpen('/repos/b')).toBe(false); // global last-used
    writeRightSidebarOpen('/repos/b', true);
    expect(readRightSidebarOpen('/repos/a')).toBe(false);
    expect(readRightSidebarOpen('/repos/b')).toBe(true);
  });

  it('falls back to legacy global key when workspace is unset', () => {
    localStorage.setItem('sideboard.rightSidebar', '0');
    expect(readRightSidebarOpen(null)).toBe(false);
    writeRightSidebarOpen(null, true);
    expect(localStorage.getItem('sideboard.rightSidebar')).toBe('1');
  });
});
