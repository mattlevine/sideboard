import { describe, expect, it } from 'vitest';
import { BAKED_SLACK_CLIENT_ID } from './baked-app.js';
import { clientIdFromOAuthState, slackOAuthState } from './oauth-state.js';

describe('slack OAuth state', () => {
  it('keeps the baked app state free of a client id', () => {
    const state = slackOAuthState(BAKED_SLACK_CLIENT_ID, BAKED_SLACK_CLIENT_ID);
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(clientIdFromOAuthState(state)).toBeNull();
  });

  it('round-trips a company client id', () => {
    const state = slackOAuthState('123.456', BAKED_SLACK_CLIENT_ID);
    expect(clientIdFromOAuthState(state)).toBe('123.456');
  });
});
