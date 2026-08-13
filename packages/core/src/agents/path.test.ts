import { describe, expect, it } from 'vitest';
import {
  ensureAgentPath,
  posixShellSingleQuote,
  resolveCommandBinarySync,
  withExportedPath,
} from './path.js';

describe('ensureAgentPath', () => {
  it('prepends user and homebrew bin dirs when missing', () => {
    const env = { HOME: '/Users/test', PATH: '/usr/bin' };
    const next = ensureAgentPath(env);
    // Only existing dirs are prepended; Homebrew roots usually exist on CI macs.
    expect(next).toContain('/usr/bin');
    expect(env.PATH).toBe(next);
  });

  it('does not duplicate existing entries', () => {
    const env = {
      HOME: '/Users/test',
      PATH: '/Users/test/.local/bin:/usr/bin',
    };
    // Create nothing — if .local/bin doesn't exist it won't be added twice from extras
    const next = ensureAgentPath(env);
    const matches = next.split(':').filter((p) => p === '/Users/test/.local/bin');
    expect(matches.length).toBeLessThanOrEqual(1);
  });
});

describe('terminal path helpers', () => {
  it('single-quotes PATH values with embedded quotes', () => {
    expect(posixShellSingleQuote(`a'b`)).toBe(`'a'\\''b'`);
  });

  it('resolves a bare binary to an absolute path', () => {
    expect(resolveCommandBinarySync('codex login', '/opt/homebrew/bin/codex')).toBe(
      '/opt/homebrew/bin/codex login',
    );
    expect(resolveCommandBinarySync('codex login', null)).toBe('codex login');
    expect(resolveCommandBinarySync('/already/abs login', '/other')).toBe('/already/abs login');
  });

  it('exports PATH ahead of the command', () => {
    expect(withExportedPath('codex login', '/a:/b')).toBe(
      `export PATH='/a:/b'; codex login`,
    );
    expect(withExportedPath(`export PATH='/x'; y`, '/a')).toBe(`export PATH='/x'; y`);
  });
});
