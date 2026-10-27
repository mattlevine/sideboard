import { describe, expect, it } from 'vitest';
import { parseEntireAuthContexts } from './entire-git.js';

describe('parseEntireAuthContexts', () => {
  it('reads the handle on the active context row', () => {
    const text = [
      'CONTEXT             HANDLE     LOGIN SERVER',
      'auth.entire.io      octocat    https://auth.entire.io    (active)',
      'staging.entire.io   other      https://staging.entire.io',
    ].join('\n');
    expect(parseEntireAuthContexts(text)).toEqual({ account: 'octocat' });
  });

  it('returns null when nothing is active', () => {
    expect(parseEntireAuthContexts('CONTEXT  HANDLE  LOGIN SERVER\n')).toEqual({
      account: null,
    });
    expect(parseEntireAuthContexts('')).toEqual({ account: null });
  });
});
