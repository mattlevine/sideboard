import { afterEach, describe, expect, it } from 'vitest';
import type { WorktreeOpener } from '@sideboard-ai/core';
import {
  COPY_WORKTREE_PATH_KBD,
  FALLBACK_WORKTREE_OPENERS,
  matchWorktreeOpenShortcut,
  pickTriggerOpener,
  readLastWorktreeOpener,
  writeLastWorktreeOpener,
} from './worktree-opener';

const original = globalThis.localStorage;

describe('worktree-opener prefs', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
  });

  it('defaults to cursor and round-trips the last opener', () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
    expect(readLastWorktreeOpener()).toBe('cursor');
    writeLastWorktreeOpener('finder');
    expect(readLastWorktreeOpener()).toBe('finder');
    writeLastWorktreeOpener('code');
    expect(readLastWorktreeOpener()).toBe('code');
  });

  it('ignores unknown stored ids', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => 'notepad',
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(readLastWorktreeOpener()).toBe('cursor');
  });
});

describe('pickTriggerOpener', () => {
  it('uses the last opener when it has a real icon', () => {
    const openers: WorktreeOpener[] = [
      { id: 'finder', label: 'Finder', kbd: '1', installed: true, iconDataUrl: 'data:finder' },
      { id: 'cursor', label: 'Cursor', kbd: '2', installed: true, iconDataUrl: 'data:cursor' },
    ];
    expect(pickTriggerOpener(openers, 'cursor')?.iconDataUrl).toBe('data:cursor');
  });

  it('falls back to the first available real icon', () => {
    const openers: WorktreeOpener[] = [
      { id: 'cursor', label: 'Cursor', kbd: '2', installed: false },
      { id: 'finder', label: 'Finder', kbd: '1', installed: true, iconDataUrl: 'data:finder' },
    ];
    expect(pickTriggerOpener(openers, 'cursor')?.id).toBe('finder');
  });
});

describe('matchWorktreeOpenShortcut', () => {
  const key = (
    k: string,
    mods: { meta?: boolean; ctrl?: boolean; alt?: boolean } = {},
  ) => ({
    key: k,
    metaKey: Boolean(mods.meta),
    ctrlKey: Boolean(mods.ctrl),
    altKey: Boolean(mods.alt),
  });

  it('maps 1–7 in list order while the menu is open', () => {
    expect(matchWorktreeOpenShortcut(key('1'), FALLBACK_WORKTREE_OPENERS, true)).toEqual({
      type: 'open',
      id: 'finder',
    });
    expect(matchWorktreeOpenShortcut(key('2'), FALLBACK_WORKTREE_OPENERS, true)).toEqual({
      type: 'open',
      id: 'cursor',
    });
    expect(matchWorktreeOpenShortcut(key('3'), FALLBACK_WORKTREE_OPENERS, true)).toEqual({
      type: 'open',
      id: 'code',
    });
    expect(matchWorktreeOpenShortcut(key(COPY_WORKTREE_PATH_KBD), FALLBACK_WORKTREE_OPENERS, true)).toEqual({
      type: 'copy',
    });
  });

  it('does not steal digits when the menu is closed', () => {
    expect(matchWorktreeOpenShortcut(key('1'), FALLBACK_WORKTREE_OPENERS, false)).toBeNull();
  });

  it('opens Cursor with ⌘O even when the menu is closed', () => {
    expect(
      matchWorktreeOpenShortcut(key('o', { meta: true }), FALLBACK_WORKTREE_OPENERS, false),
    ).toEqual({ type: 'open', id: 'cursor' });
  });
});
