import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { REMOTE_RELAY_PATH } from '../remote/protocol.js';
import { SLACK_RELAY_DESKTOP_PATH } from '../slack/oauth-redirect.js';
import { startRelayServer, type RelayServerHandle } from './server.js';

async function openSocket(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`timed out opening ${url}`));
    }, 3_000);
    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('relay websocket paths', () => {
  let handle: RelayServerHandle | null = null;

  afterEach(async () => {
    await handle?.close();
    handle = null;
  });

  it('accepts the phone relay and the Slack desktop on the same port', async () => {
    handle = await startRelayServer({
      skipSocketMode: true,
      host: '127.0.0.1',
      port: 0,
    });
    const base = `ws://127.0.0.1:${handle.port}`;
    await openSocket(`${base}${REMOTE_RELAY_PATH}`);
    await openSocket(`${base}${SLACK_RELAY_DESKTOP_PATH}`);
    expect(handle.port).toBeGreaterThan(0);
  });
});
