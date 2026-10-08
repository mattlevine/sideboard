import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { REMOTE_RELAY_PATH } from '../remote/protocol.js';
import { startRelayServer, type RelayServerHandle } from './server.js';

async function once(url: string, message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timed out'));
    }, 3000);
    ws.on('open', () => ws.send(JSON.stringify(message)));
    ws.on('message', (data) => {
      clearTimeout(timer);
      ws.close();
      resolve(JSON.parse(String(data)) as unknown);
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('relay account sign-in', () => {
  let handle: RelayServerHandle | null = null;
  const accountsPath = join(mkdtempSync(join(tmpdir(), 'sb-relay-http-')), 'accounts.sqlite');

  afterEach(async () => {
    await handle?.close();
    handle = null;
  });

  async function listen(): Promise<string> {
    handle = await startRelayServer({
      skipSocketMode: true,
      host: '127.0.0.1',
      port: 0,
      accountsPath,
      relayOAuth: { github: { clientId: 'gid', clientSecret: 'gsecret' } },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('github.com/login/oauth/access_token')) {
          return new Response(JSON.stringify({ access_token: 'github-access' }));
        }
        if (url.includes('api.github.com/user/emails')) {
          return new Response(
            JSON.stringify([{ email: 'ada@example.com', primary: true, verified: true }]),
          );
        }
        if (url.includes('api.github.com/user')) {
          return new Response(JSON.stringify({ id: 99 }));
        }
        throw new Error(`unexpected fetch ${url}`);
      },
    });
    return `http://127.0.0.1:${handle.port}`;
  }

  it('keeps the signed-in Mac after the relay process restarts', async () => {
    const origin = await listen();
    const state = 'a'.repeat(32);
    const started = await fetch(`${origin}/remote/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github', state }),
    });
    const startBody = (await started.json()) as { url?: string };
    expect(startBody.url).toContain('github.com/login/oauth/authorize');
    const callback = await fetch(`${origin}/remote/oauth/callback?code=from-github&state=${state}`);
    expect(callback.status).toBe(200);
    const html = await callback.text();
    expect(html).toContain('Signed in');
    expect(html).toContain('class="mark"');
    expect(html).toContain('#09090b');
    expect(html).toContain('>Sideboard</div>');
    const result = await fetch(`${origin}/remote/oauth/result?state=${state}`);
    const session = (await result.json()) as { credential?: string };
    expect(session.credential).toBeTruthy();

    const wsUrl = `ws://127.0.0.1:${handle!.port}${REMOTE_RELAY_PATH}`;
    const missing = await once(wsUrl, {
      type: 'host_register',
      deviceId: 'mac-1',
      deviceLabel: 'Work',
      hostSecret: 'host-secret',
    });
    expect(missing).toEqual({ type: 'error', message: 'sign in required' });
    const registered = await once(wsUrl, {
      type: 'host_register',
      deviceId: 'mac-1',
      deviceLabel: 'Work',
      hostSecret: 'host-secret',
      accountToken: session.credential,
    });
    expect(registered).toMatchObject({ type: 'registered', deviceId: 'mac-1' });

    await handle!.close();
    handle = null;
    const restarted = await listen();
    expect(restarted).toContain('127.0.0.1');
    const again = await once(`ws://127.0.0.1:${handle!.port}${REMOTE_RELAY_PATH}`, {
      type: 'host_register',
      deviceId: 'mac-1',
      deviceLabel: 'Work',
      hostSecret: 'host-secret',
      accountToken: session.credential,
    });
    expect(again).toMatchObject({ type: 'registered', deviceId: 'mac-1' });
    const wrong = await once(`ws://127.0.0.1:${handle!.port}${REMOTE_RELAY_PATH}`, {
      type: 'host_register',
      deviceId: 'mac-1',
      deviceLabel: 'Work',
      hostSecret: 'other',
      accountToken: session.credential,
    });
    expect(wrong).toEqual({ type: 'error', message: 'host secret rejected' });
  });
});
