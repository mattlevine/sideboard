import { describe, expect, it } from 'vitest';
import { parseOriginAuthStatus } from './cursor-git.js';

describe('parseOriginAuthStatus', () => {
  it('reads the account and auth method from origin auth status', () => {
    const text = [
      'Account:     dev@example.com (user_abc)',
      'Auth method: api-key (ambient CURSOR_API_KEY environment variable)',
      'Endpoint:    https://api2.cursor.sh',
    ].join('\n');
    expect(parseOriginAuthStatus(text)).toEqual({
      account: 'dev@example.com (user_abc)',
      authMethod: 'api-key (ambient CURSOR_API_KEY environment variable)',
    });
  });

  it('returns nulls when the CLI is signed out', () => {
    expect(parseOriginAuthStatus('not logged in\n')).toEqual({
      account: null,
      authMethod: null,
    });
  });
});
