import type { IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { REMOTE_RELAY_PATH } from '../remote/protocol.js';
import {
  assertRelayPublicOrigin,
  relayClientIp,
  startRelayServer,
  type RelayServerHandle,
} from './server.js';

function fakeReq(headers: IncomingMessage['headers'], remoteAddress = '127.0.0.1'): IncomingMessage {
  return { headers, socket: { remoteAddress } } as IncomingMessage;
}

function holdSocket(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, headers ? { headers } : undefined);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`timed out opening ${url}`));
    }, 3_000);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('relay client address', () => {
  const prevTrust = process.env.SIDEBOARD_RELAY_TRUST_PROXY;

  afterEach(() => {
    if (prevTrust === undefined) delete process.env.SIDEBOARD_RELAY_TRUST_PROXY;
    else process.env.SIDEBOARD_RELAY_TRUST_PROXY = prevTrust;
  });

  it('uses the last forwarded hop only when the proxy is trusted', () => {
    delete process.env.SIDEBOARD_RELAY_TRUST_PROXY;
    const headers = { 'x-forwarded-for': '1.1.1.1, 203.0.113.5' };
    expect(relayClientIp(fakeReq(headers))).toBe('127.0.0.1');
    process.env.SIDEBOARD_RELAY_TRUST_PROXY = '1';
    expect(relayClientIp(fakeReq(headers))).toBe('203.0.113.5');
    expect(relayClientIp(fakeReq({ 'fly-client-ip': '198.51.100.10', ...headers }))).toBe(
      '198.51.100.10',
    );
  });
});

describe('production public origin', () => {
  it('refuses a production boot when the origin is unset', () => {
    expect(() => assertRelayPublicOrigin({ NODE_ENV: 'production' })).toThrow(
      /SIDEBOARD_RELAY_PUBLIC_ORIGIN/,
    );
    expect(() =>
      assertRelayPublicOrigin({
        NODE_ENV: 'production',
        SIDEBOARD_RELAY_PUBLIC_ORIGIN: 'https://relay.example.com',
      }),
    ).not.toThrow();
    expect(() => assertRelayPublicOrigin({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('startRelayServer exits before listen when production has no origin', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevOrigin = process.env.SIDEBOARD_RELAY_PUBLIC_ORIGIN;
    process.env.NODE_ENV = 'production';
    delete process.env.SIDEBOARD_RELAY_PUBLIC_ORIGIN;
    try {
      await expect(
        startRelayServer({ skipSocketMode: true, host: '127.0.0.1', port: 0 }),
      ).rejects.toThrow(/SIDEBOARD_RELAY_PUBLIC_ORIGIN/);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevOrigin === undefined) delete process.env.SIDEBOARD_RELAY_PUBLIC_ORIGIN;
      else process.env.SIDEBOARD_RELAY_PUBLIC_ORIGIN = prevOrigin;
    }
  });
});

describe('phone relay health and rate limit', () => {
  let handle: RelayServerHandle | null = null;
  let dir: string | null = null;
  const prevTrust = process.env.SIDEBOARD_RELAY_TRUST_PROXY;
  const open: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of open) ws.terminate();
    open.length = 0;
    await handle?.close();
    handle = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
    if (prevTrust === undefined) delete process.env.SIDEBOARD_RELAY_TRUST_PROXY;
    else process.env.SIDEBOARD_RELAY_TRUST_PROXY = prevTrust;
  });

  it('reports phone sockets, the account file, and which providers are configured', async () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-health-'));
    handle = await startRelayServer({
      skipSocketMode: true,
      host: '127.0.0.1',
      port: 0,
      accountsPath: join(dir, 'relay-accounts.sqlite'),
      relayOAuth: {
        github: { clientId: 'gh', clientSecret: 'sec' },
        cursor: { clientId: 'app_cursor' },
      },
    });
    const ws = await holdSocket(`ws://127.0.0.1:${handle.port}${REMOTE_RELAY_PATH}`);
    open.push(ws);
    const health = (await (await fetch(`http://127.0.0.1:${handle.port}/health`)).json()) as {
      phoneSockets: number;
      accounts: boolean;
      providers: { github: boolean; cursor: boolean; entire: boolean };
    };
    expect(health).toMatchObject({
      ok: true,
      service: 'sideboard-relay',
      phoneSockets: 1,
      accounts: true,
      providers: { github: true, cursor: true, entire: false },
    });
    const root = (await (await fetch(`http://127.0.0.1:${handle.port}/`)).json()) as {
      phoneSockets: number;
    };
    expect(root.phoneSockets).toBe(1);
  });

  it('closes an over-limit phone socket and keeps a different forwarded address', async () => {
    process.env.SIDEBOARD_RELAY_TRUST_PROXY = '1';
    const lines: string[] = [];
    handle = await startRelayServer({
      skipSocketMode: true,
      host: '127.0.0.1',
      port: 0,
      onLog: (line) => lines.push(line),
    });
    const url = `ws://127.0.0.1:${handle.port}${REMOTE_RELAY_PATH}`;
    for (let i = 0; i < 20; i++) {
      open.push(await holdSocket(url, { 'x-forwarded-for': '203.0.113.5' }));
    }
    const rejected = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { 'x-forwarded-for': '203.0.113.5' } });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('timed out waiting for rate limit'));
      }, 3_000);
      ws.on('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
      ws.on('error', () => undefined);
    });
    expect(rejected).toEqual({ code: 4029, reason: 'too many connections' });
    expect(lines.some((line) => line.includes('remote rate limit: 203.0.113.5'))).toBe(true);
    open.push(await holdSocket(url, { 'x-forwarded-for': '203.0.113.6' }));
  });
});
