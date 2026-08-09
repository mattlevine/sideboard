import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readRightColumnWidth,
  RIGHT_COLUMN_WIDTH_FALLBACK,
  writeRightColumnWidth,
} from './panel-widths';

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

describe('panel-widths', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults, then remembers per worktree without cross-bleed', () => {
    expect(readRightColumnWidth('/wt/monaco')).toBe(RIGHT_COLUMN_WIDTH_FALLBACK);
    writeRightColumnWidth('/wt/monaco', 560);
    expect(readRightColumnWidth('/wt/monaco')).toBe(560);
    expect(readRightColumnWidth('/wt/cruzeiro')).toBe(RIGHT_COLUMN_WIDTH_FALLBACK);
    writeRightColumnWidth('/wt/cruzeiro/', 720);
    expect(readRightColumnWidth('/wt/monaco')).toBe(560);
    expect(readRightColumnWidth('/wt/cruzeiro')).toBe(720);
  });

  it('clamps out-of-range widths', () => {
    writeRightColumnWidth('/wt/monaco', 50);
    expect(readRightColumnWidth('/wt/monaco')).toBe(320);
    writeRightColumnWidth('/wt/monaco', 5000);
    expect(readRightColumnWidth('/wt/monaco')).toBe(900);
  });
});
