import { describe, expect, it } from 'vitest';
import { ensureAgentPath } from './path.js';

describe('ensureAgentPath', () => {
  it('prepends user and homebrew bin dirs when missing', () => {
    const env = { HOME: '/Users/test', PATH: '/usr/bin' };
    const next = ensureAgentPath(env);
    expect(next.startsWith('/Users/test/.local/bin')).toBe(true);
    expect(next).toContain('/opt/homebrew/bin');
    expect(next).toContain('/Users/test/Library/pnpm');
    expect(next.endsWith('/usr/bin')).toBe(true);
  });

  it('does not duplicate existing entries', () => {
    const env = {
      HOME: '/Users/test',
      PATH: '/Users/test/.local/bin:/usr/bin',
    };
    const next = ensureAgentPath(env);
    const matches = next.split(':').filter((p) => p === '/Users/test/.local/bin');
    expect(matches).toHaveLength(1);
  });
});
