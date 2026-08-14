import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { slackOAuthAuthorizeUrl, SLACK_OAUTH_REDIRECT, startSlackOAuth } from './oauth.js';
import { BAKED_SLACK_CLIENT_ID, hasBakedSlackOAuth } from './baked-app.js';
import { exchangeSlackOAuthCode, SlackOAuthPendingStore } from './oauth-exchange.js';

describe('slack OAuth URL', () => {
  it('includes client_id, user_scope search, and https redirect', () => {
    const url = slackOAuthAuthorizeUrl('CLIENT', 'state123');
    expect(url).toContain('https://slack.com/oauth/v2/authorize?');
    expect(url).not.toContain('brightsy.slack.com');
    expect(url).toContain('client_id=CLIENT');
    expect(url).toContain('state=state123');
    expect(url).toContain(encodeURIComponent(SLACK_OAUTH_REDIRECT));
    expect(SLACK_OAUTH_REDIRECT).toBe('https://relay.sideboard.cloud/slack/callback');
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

  it('Add via browser uses baked Client ID and no baked secret', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-slack-oauth-'));
    delete process.env.SIDEBOARD_SLACK_CLIENT_ID;
    delete process.env.SIDEBOARD_SLACK_CLIENT_SECRET;
    expect(hasBakedSlackOAuth()).toBe(true);
    const { slackOAuthCredentials } = await import('./oauth.js');
    const creds = slackOAuthCredentials();
    expect(creds.clientId).toBe(BAKED_SLACK_CLIENT_ID);
    expect(creds.clientSecret).toBeNull();
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
      fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: 'pending' }), { status: 404 }),
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

  it('polls the relay result URL and stores tokens', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-slack-oauth-poll-'));
    let calls = 0;
    const info = await startSlackOAuth({
      openUrl: () => undefined,
      timeoutMs: 5_000,
      pollIntervalMs: 1,
      fetchImpl: async () => {
        calls += 1;
        if (calls < 2) {
          return new Response(JSON.stringify({ ok: false, error: 'pending' }), { status: 404 });
        }
        return new Response(
          JSON.stringify({
            ok: true,
            team_id: 'T1',
            team_name: 'Acme',
            user_id: 'U1',
            bot_token: 'xoxb-bot',
            user_token: 'xoxp-user',
            scopes: 'chat:write',
          }),
          { status: 200 },
        );
      },
    });
    expect(info).toMatchObject({ team_id: 'T1', team_name: 'Acme', has_bot_token: true });
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

describe('exchangeSlackOAuthCode', () => {
  it('posts client_secret only to Slack and maps the payload', async () => {
    const posted: string[] = [];
    const payload = await exchangeSlackOAuthCode({
      clientId: 'CID',
      clientSecret: 'shh',
      code: 'code-1',
      redirectUri: 'https://relay.sideboard.cloud/slack/callback',
      fetchImpl: (async (_url, init) => {
        posted.push(String(init?.body ?? ''));
        return new Response(
          JSON.stringify({
            ok: true,
            access_token: 'xoxb-bot',
            scope: 'chat:write',
            authed_user: { id: 'U1', access_token: 'xoxp-user', scope: 'search:read' },
            team: { id: 'T9', name: 'Nine' },
          }),
        );
      }) as typeof fetch,
    });
    expect(posted[0]).toContain('client_secret=shh');
    expect(posted[0]).toContain('code=code-1');
    expect(payload).toMatchObject({
      team_id: 'T9',
      team_name: 'Nine',
      user_id: 'U1',
      bot_token: 'xoxb-bot',
      user_token: 'xoxp-user',
    });
  });
});

describe('SlackOAuthPendingStore', () => {
  it('hands out a result once', () => {
    const store = new SlackOAuthPendingStore();
    store.put('s', {
      ok: true,
      payload: {
        team_id: 'T1',
        team_name: 'T',
        scopes: '',
      },
    });
    expect(store.take('s')?.ok).toBe(true);
    expect(store.take('s')).toBeNull();
  });
});
