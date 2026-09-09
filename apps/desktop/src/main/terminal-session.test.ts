import { describe, expect, it } from 'vitest';
import {
  MAX_TERMINAL_SCROLLBACK,
  appendTerminalScrollback,
  findReusableTerminalSession,
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

  it('finds the matching live session for a thread + kind', () => {
    const sessions = [
      { threadRef: 'a', kind: 'shell' as const },
      { threadRef: 'a', kind: 'attach' as const },
      { threadRef: 'b', kind: 'shell' as const },
    ];
    expect(findReusableTerminalSession(sessions, 'a', 'shell')).toEqual(sessions[0]);
    expect(findReusableTerminalSession(sessions, 'a', 'attach')).toEqual(sessions[1]);
    expect(findReusableTerminalSession(sessions, 'c', 'shell')).toBeUndefined();
  });
});
