import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { slackOAuthAuthorizeUrl, SLACK_OAUTH_REDIRECT, startSlackOAuth } from './oauth.js';
import { BAKED_SLACK_CLIENT_ID, hasBakedSlackOAuth } from './baked-app.js';

describe('slack OAuth URL', () => {
  it('includes client_id, user_scope search, and https redirect', () => {
    const url = slackOAuthAuthorizeUrl('CLIENT', 'state123');
    expect(url).toContain('https://slack.com/oauth/v2/authorize?');
    expect(url).not.toContain('brightsy.slack.com');
    expect(url).toContain('client_id=CLIENT');
    expect(url).toContain('state=state123');
    expect(url).toContain(encodeURIComponent(SLACK_OAUTH_REDIRECT));
    expect(SLACK_OAUTH_REDIRECT).toBe('https://slack-relay.sideboard.cloud/callback');
    expect(url).toContain(encodeURIComponent('search:read'));
    expect(url).toContain(encodeURIComponent('app_mentions:read'));
    expect(url).toContain(encodeURIComponent('reactions:write'));
    expect(url).toContain(encodeURIComponent('im:write'));
    expect(url).toContain(encodeURIComponent('chat:write.public'));
    expect(url).toContain('user_scope=');
  });
});

describe('baked Sideboard Slack app', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  const prevId = process.env.SIDEBOARD_SLACK_CLIENT_ID;
  const prevSecret = process.env.SIDEBOARD_SLACK_CLIENT_SECRET;

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    if (prevId === undefined) delete process.env.SIDEBOARD_SLACK_CLIENT_ID;
    else process.env.SIDEBOARD_SLACK_CLIENT_ID = prevId;
    if (prevSecret === undefined) delete process.env.SIDEBOARD_SLACK_CLIENT_SECRET;
    else process.env.SIDEBOARD_SLACK_CLIENT_SECRET = prevSecret;
  });

  it('Add via browser uses baked Client ID when settings are empty', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-slack-oauth-'));
    delete process.env.SIDEBOARD_SLACK_CLIENT_ID;
    delete process.env.SIDEBOARD_SLACK_CLIENT_SECRET;
    expect(hasBakedSlackOAuth()).toBe(true);
    const { slackOAuthCredentials } = await import('./oauth.js');
    const creds = slackOAuthCredentials();
    expect(creds.clientId).toBe(BAKED_SLACK_CLIENT_ID);
    expect(creds.clientSecret.length).toBeGreaterThan(8);
  });

  it('AbortSignal cancels a waiting Slack sign-in', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-slack-oauth-cancel-'));
    const ac = new AbortController();
    const pending = startSlackOAuth({
      openUrl: () => {
        ac.abort();
      },
      timeoutMs: 5_000,
      signal: ac.signal,
    });
    await expect(pending).rejects.toMatchObject({ name: 'SlackOAuthCancelledError' });
  });

  it('already-aborted signal does not wait for Slack', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-slack-oauth-aborted-'));
    const ac = new AbortController();
    ac.abort();
    await expect(
      startSlackOAuth({
        openUrl: () => {
          throw new Error('should not open the browser');
        },
        signal: ac.signal,
      }),
    ).rejects.toMatchObject({ name: 'SlackOAuthCancelledError' });
  });
});
