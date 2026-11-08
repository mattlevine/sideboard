import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clientIdFromOAuthState, slackOAuthState } from '../slack/oauth-state.js';
import { GITHUB_ACCOUNT_ISSUER, RelayAccountStore } from './accounts.js';
import { startRelayServer } from './server.js';
import { SlackAppStore } from './slack-apps.js';
import { parseSlackTokenKey } from '../slack/secret-box.js';

function sign(secret: string, body: string, timestamp: number): Record<string, string> {
  const hmac = createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex');
  return {
    'Content-Type': 'application/json',
    'X-Slack-Request-Timestamp': String(timestamp),
    'X-Slack-Signature': `v0=${hmac}`,
  };
}

describe('per-company Slack apps on the relay', () => {
  const handles: Array<{ close: () => Promise<void>; hub: { botTokenFor(teamId: string): string | null } }> = [];
  const key = randomBytes(32).toString('base64');

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.close()));
  });

  it('stores the bot token across a restart, checks signatures, and exchanges with that app', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sb-slack-org-')), 'accounts.sqlite');
    const accounts = new RelayAccountStore(file);
    const signed = accounts.signIn({
      issuer: GITHUB_ACCOUNT_ISSUER,
      subject: '7',
      email: 'ada@example.com',
      emailVerified: true,
    });
    accounts.close();

    const slackCalls: string[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
      slackCalls.push(`${href} auth=${auth} ${String(init?.body ?? '')}`);
      if (href.includes('oauth.v2.access')) {
        return new Response(
          JSON.stringify({
            ok: true,
            access_token: 'xoxb-org',
            bot_user_id: 'B1',
            scope: 'chat:write',
            authed_user: { id: 'U1', access_token: 'xoxp-user' },
            team: { id: 'T1', name: 'Acme' },
          }),
        );
      }
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;

    const start = () =>
      startRelayServer({
        appToken: 'xapp-test',
        clientId: 'BAKED',
        clientSecret: 'baked-secret',
        skipSocketMode: true,
        accountsPath: file,
        slackTokenKey: key,
        relayPublicOrigin: 'https://relay.test',
        fetchImpl,
      });

    const first = await start();
    handles.push(first);
    const origin = `http://127.0.0.1:${first.port}`;
    const createdRes = await fetch(`${origin}/slack/apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${signed.credential}` },
    });
    expect(createdRes.status).toBe(200);
    const created = (await createdRes.json()) as {
      registrationId: string;
      writeToken: string;
      manifest: string;
      eventsUrl: string;
    };
    expect(created.eventsUrl).toBe(`https://relay.test/slack/events/${created.registrationId}`);
    expect(created.manifest).not.toContain('search:read');
    expect(created.manifest).not.toContain('\n    user:\n');
    expect(created.manifest).toContain('socket_mode_enabled: false');
    expect(created.manifest).not.toContain(created.writeToken);

    const unauth = await fetch(`${origin}/slack/apps`, { method: 'POST' });
    expect(unauth.status).toBe(401);

    const challenge = await fetch(`${origin}/slack/events/${created.registrationId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'url_verification', challenge: 'ready' }),
    });
    expect(await challenge.json()).toEqual({ challenge: 'ready' });

    const saved = await fetch(`${origin}/slack/apps/${created.registrationId}/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writeToken: created.writeToken,
        clientId: 'ORG.1',
        clientSecret: 'org-secret',
        signingSecret: 'org-sign',
      }),
    });
    expect(saved.status).toBe(200);

    const unsigned = await fetch(`${origin}/slack/events/${created.registrationId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'url_verification', challenge: 'later' }),
    });
    expect(unsigned.status).toBe(401);

    const state = slackOAuthState('ORG.1', 'BAKED');
    expect(clientIdFromOAuthState(state)).toBe('ORG.1');
    const oauth = await fetch(`${origin}/slack/callback?code=from-slack&state=${encodeURIComponent(state)}`);
    expect(oauth.status).toBe(200);
    expect(slackCalls[0]).toContain('client_secret=org-secret');
    expect(slackCalls[0]).not.toContain('baked-secret');
    expect(first.hub.botTokenFor('T1')).toBe('xoxb-org');

    const event = JSON.stringify({
      type: 'event_callback',
      team_id: 'T1',
      event_id: 'Ev1',
      event: {
        type: 'message',
        channel: 'D1',
        channel_type: 'im',
        user: 'U1',
        text: 'hello',
        ts: '1.0',
      },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = sign('org-sign', event, timestamp);
    const before = slackCalls.length;
    const delivered = await fetch(`${origin}/slack/events/${created.registrationId}`, {
      method: 'POST',
      headers,
      body: event,
    });
    expect(delivered.status).toBe(200);
    const posts = async () =>
      slackCalls.slice(before).filter((line) => line.includes('chat.postMessage'));
    for (let i = 0; i < 30 && (await posts()).length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await posts()).toHaveLength(1);
    expect((await posts())[0]).toContain('Bearer xoxb-org');
    const again = await fetch(`${origin}/slack/events/${created.registrationId}`, {
      method: 'POST',
      headers,
      body: event,
    });
    expect(again.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await posts()).toHaveLength(1);

    const bad = await fetch(`${origin}/slack/events/${created.registrationId}`, {
      method: 'POST',
      headers: { ...headers, 'X-Slack-Signature': 'v0=00' },
      body: event,
    });
    expect(bad.status).toBe(401);

    await first.close();
    handles.pop();

    const second = await start();
    handles.push(second);
    expect(second.hub.botTokenFor('T1')).toBe('xoxb-org');
    await second.close();
    handles.pop();

    const stored = new SlackAppStore(file, parseSlackTokenKey(key));
    expect(stored.listBots()).toEqual([{ teamId: 'T1', botToken: 'xoxb-org' }]);
    stored.close();
  });
});
