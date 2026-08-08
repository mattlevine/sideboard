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

  it('falls back to default then remembers per thread', () => {
    expect(readRightColumnWidth('t1')).toBe(RIGHT_COLUMN_WIDTH_FALLBACK);
    writeRightColumnWidth('t1', 560);
    expect(readRightColumnWidth('t1')).toBe(560);
    expect(readRightColumnWidth('t2')).toBe(560); // global last-used for new threads
    writeRightColumnWidth('t2', 720);
    expect(readRightColumnWidth('t1')).toBe(560);
    expect(readRightColumnWidth('t2')).toBe(720);
  });

  it('clamps out-of-range widths', () => {
    writeRightColumnWidth('t1', 50);
    expect(readRightColumnWidth('t1')).toBe(320);
    writeRightColumnWidth('t1', 5000);
    expect(readRightColumnWidth('t1')).toBe(900);
  });
});
