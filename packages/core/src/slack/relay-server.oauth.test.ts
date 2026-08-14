import { afterEach, describe, expect, it } from 'vitest';
import { startSlackRelayServer } from './relay-server.js';

describe('Slack relay OAuth exchange', () => {
  const handles: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((h) => h.close()));
  });

  it('exchanges the code on the relay and does not echo it on /slack/oauth/result until consumed', async () => {
    const slackCalls: string[] = [];
    const handle = await startSlackRelayServer({
      appToken: 'xapp-test',
      clientSecret: 'relay-secret',
      clientId: 'CID',
      skipSocketMode: true,
      fetchImpl: (async (url, init) => {
        slackCalls.push(`${url} ${String(init?.body ?? '')}`);
        return new Response(
          JSON.stringify({
            ok: true,
            access_token: 'xoxb-bot',
            scope: 'chat:write',
            authed_user: { id: 'U1', access_token: 'xoxp-user' },
            team: { id: 'T1', name: 'Acme' },
          }),
        );
      }) as typeof fetch,
    });
    handles.push(handle);

    const origin = `http://127.0.0.1:${handle.port}`;
    const pending = await fetch(`${origin}/slack/oauth/result?state=abc`);
    expect(pending.status).toBe(404);
    expect(await pending.json()).toMatchObject({ error: 'pending' });

    const cb = await fetch(`${origin}/slack/callback?code=from-slack&state=abc`);
    expect(cb.status).toBe(200);
    const html = await cb.text();
    expect(html).toContain('Slack workspace connected');
    expect(html).not.toContain('from-slack');
    expect(html).not.toContain('xoxb-bot');
    expect(slackCalls[0]).toContain('client_secret=relay-secret');
    expect(slackCalls[0]).toContain('code=from-slack');

    const result = await fetch(`${origin}/slack/oauth/result?state=abc`);
    expect(result.status).toBe(200);
    const json = (await result.json()) as { bot_token?: string; team_id?: string };
    expect(json).toMatchObject({ ok: true, team_id: 'T1', bot_token: 'xoxb-bot' });

    const again = await fetch(`${origin}/slack/oauth/result?state=abc`);
    expect(again.status).toBe(404);
  });

  it('records access_denied for the desktop poll without leaking a code', async () => {
    const handle = await startSlackRelayServer({
      appToken: 'xapp-test',
      clientSecret: 'relay-secret',
      skipSocketMode: true,
      fetchImpl: (async () => new Response('nope')) as typeof fetch,
    });
    handles.push(handle);
    const origin = `http://127.0.0.1:${handle.port}`;
    const cb = await fetch(`${origin}/slack/callback?error=access_denied&state=nope`);
    expect(cb.status).toBe(400);
    const result = await fetch(`${origin}/slack/oauth/result?state=nope`);
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({
      ok: false,
      error: 'Slack OAuth: access_denied',
    });
  });
});
