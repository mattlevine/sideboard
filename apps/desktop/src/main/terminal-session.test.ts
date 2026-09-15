import { describe, expect, it } from 'vitest';
import {
  MAX_TERMINAL_SCROLLBACK,
  appendTerminalScrollback,
  findReusableTerminalSession,
  shouldTeardownTerminalSession,
  terminalReuseKey,
  terminalSessionKind,
} from './terminal-session';

describe('appendTerminalScrollback', () => {
  it('concatenates chunks and no-ops empty data', () => {
    expect(appendTerminalScrollback('ab', '')).toBe('ab');
    expect(appendTerminalScrollback('ab', 'cd')).toBe('abcd');
  });

  it('keeps the newest bytes when over the cap', () => {
    expect(appendTerminalScrollback('hello', 'world', 6)).toBe('oworld');
    const big = 'x'.repeat(MAX_TERMINAL_SCROLLBACK + 50);
    const next = appendTerminalScrollback('', big);
    expect(next.length).toBe(MAX_TERMINAL_SCROLLBACK);
    expect(next).toBe(big.slice(big.length - MAX_TERMINAL_SCROLLBACK));
  });
});

describe('terminal session reuse', () => {
  it('treats a custom command as attach, otherwise shell', () => {
    expect(terminalSessionKind()).toBe('shell');
    expect(terminalSessionKind({})).toBe('shell');
    expect(terminalSessionKind({ command: '/usr/bin/claude' })).toBe('attach');
  });

  it('keys shell by worktree and attach by chat', () => {
    expect(terminalReuseKey('shell', '/wt/paris', 'chat-a')).toBe('shell:/wt/paris');
    expect(terminalReuseKey('shell', '/wt/paris', 'chat-b')).toBe('shell:/wt/paris');
    expect(terminalReuseKey('attach', '/wt/paris', 'chat-a')).toBe('attach:chat-a');
    expect(terminalReuseKey('attach', '/wt/paris', 'chat-b')).toBe('attach:chat-b');
  });

  it('finds the matching live session for a reuse key + kind', () => {
    const sessions = [
      { reuseKey: 'shell:/wt/a', kind: 'shell' as const },
      { reuseKey: 'attach:chat-a', kind: 'attach' as const },
      { reuseKey: 'shell:/wt/b', kind: 'shell' as const },
    ];
    expect(findReusableTerminalSession(sessions, 'shell:/wt/a', 'shell')).toEqual(sessions[0]);
    expect(findReusableTerminalSession(sessions, 'attach:chat-a', 'attach')).toEqual(sessions[1]);
    expect(findReusableTerminalSession(sessions, 'shell:/wt/c', 'shell')).toBeUndefined();
  });

  it('tears down the shared shell only when the last worktree chat is gone', () => {
    const shell = { kind: 'shell' as const, threadRef: 'chat-a', worktreeKey: '/wt/paris' };
    const attach = { kind: 'attach' as const, threadRef: 'chat-a', worktreeKey: '/wt/paris' };
    expect(
      shouldTeardownTerminalSession(shell, {
        threadRef: 'chat-a',
        worktreeKey: '/wt/paris',
        lastWorktreeChat: false,
      }),
    ).toBe(false);
    expect(
      shouldTeardownTerminalSession(shell, {
        threadRef: 'chat-b',
        worktreeKey: '/wt/paris',
        lastWorktreeChat: true,
      }),
    ).toBe(true);
    expect(
      shouldTeardownTerminalSession(attach, {
        threadRef: 'chat-a',
        worktreeKey: '/wt/paris',
        lastWorktreeChat: false,
      }),
    ).toBe(true);
    expect(
      shouldTeardownTerminalSession(attach, {
        threadRef: 'chat-b',
        worktreeKey: '/wt/paris',
        lastWorktreeChat: true,
      }),
    ).toBe(false);
  });
});
