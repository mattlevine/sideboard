import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { REMOTE_RELAY_PATH } from '../remote/protocol.js';
import { startRelayServer, type RelayServerHandle } from './server.js';

type RelaySock = {
  send(message: unknown): void;
  next(): Promise<Record<string, unknown>>;
  close(): void;
};

function connect(url: string): Promise<RelaySock> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending: Array<(msg: Record<string, unknown>) => void> = [];
    const queued: Record<string, unknown>[] = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timed out'));
    }, 3000);
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as Record<string, unknown>;
      const wait = pending.shift();
      if (wait) wait(msg);
      else queued.push(msg);
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on('open', () => {
      clearTimeout(timer);
      resolve({
        send: (message) => ws.send(JSON.stringify(message)),
        next: () => {
          const msg = queued.shift();
          if (msg) return Promise.resolve(msg);
          return new Promise((done, deny) => {
            const wait = setTimeout(() => deny(new Error('timed out')), 3000);
            pending.push((row) => {
              clearTimeout(wait);
              done(row);
            });
          });
        },
        close: () => ws.close(),
      });
    });
  });
}

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

  it('keeps a phone pairing after the relay process restarts', async () => {
    const origin = await listen();
    const state = 'b'.repeat(32);
    const started = await fetch(`${origin}/remote/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github', state }),
    });
    expect(started.ok).toBe(true);
    const callback = await fetch(`${origin}/remote/oauth/callback?code=from-github&state=${state}`);
    expect(callback.status).toBe(200);
    const result = await fetch(`${origin}/remote/oauth/result?state=${state}`);
    const session = (await result.json()) as { credential?: string };
    expect(session.credential).toBeTruthy();

    const wsUrl = `ws://127.0.0.1:${handle!.port}${REMOTE_RELAY_PATH}`;
    const mac = await connect(wsUrl);
    mac.send({
      type: 'host_register',
      deviceId: 'mac-1',
      deviceLabel: 'Work',
      hostSecret: 'host-secret',
      accountToken: session.credential,
    });
    expect(await mac.next()).toMatchObject({ type: 'registered', deviceId: 'mac-1' });
    mac.send({ type: 'host_pair' });
    const code = await mac.next();
    expect(code.type).toBe('pairing_code');

    const phone = await connect(wsUrl);
    phone.send({ type: 'pair', code: code.code });
    const paired = await phone.next();
    expect(paired.type).toBe('paired');
    const token = paired.sessionToken;
    mac.close();
    phone.close();
    await handle!.close();
    handle = null;

    await listen();
    const resumedUrl = `ws://127.0.0.1:${handle!.port}${REMOTE_RELAY_PATH}`;
    const phone2 = await connect(resumedUrl);
    phone2.send({ type: 'list_hosts', sessionTokens: [token] });
    expect(await phone2.next()).toEqual({
      type: 'hosts',
      hosts: [{ sessionToken: token, deviceId: 'mac-1', deviceLabel: 'Work', online: false }],
    });
    const mac2 = await connect(resumedUrl);
    mac2.send({
      type: 'host_register',
      deviceId: 'mac-1',
      deviceLabel: 'Work',
      hostSecret: 'host-secret',
      accountToken: session.credential,
    });
    expect(await mac2.next()).toMatchObject({ type: 'registered' });
    phone2.send({ type: 'resume', sessionToken: token });
    expect(await phone2.next()).toMatchObject({ type: 'paired', sessionToken: token });
    expect(await mac2.next()).toMatchObject({ type: 'phone_joined' });
    phone2.send({ type: 'prompt', text: 'still paired' });
    expect(await mac2.next()).toEqual({ type: 'inbound', text: 'still paired' });
    mac2.close();
    phone2.close();
  });

  it('signs in with a Cursor confirmation receipt', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const jwk = publicKey.export({ format: 'jwk' }) as { x?: string };
    handle = await startRelayServer({
      skipSocketMode: true,
      host: '127.0.0.1',
      port: 0,
      accountsPath,
      relayOAuth: { cursor: { clientId: 'app_test' } },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === 'https://api.cursor.com/v1/origin/keys') {
          return new Response(
            JSON.stringify({
              keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'test-key', x: jwk.x }],
            }),
          );
        }
        throw new Error(`unexpected fetch ${url}`);
      },
    });
    const origin = `http://127.0.0.1:${handle.port}`;
    const state = 'c'.repeat(32);
    const started = await fetch(`${origin}/remote/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'cursor', state }),
    });
    const startBody = (await started.json()) as { url?: string };
    expect(startBody.url).toContain('https://cursor.com/codebase/apps/user-confirmation');
    expect(startBody.url).toContain('client_id=app_test');
    const header = Buffer.from(
      JSON.stringify({ alg: 'EdDSA', kid: 'test-key', typ: 'origin-user-confirmation-receipt+jwt' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://api.cursor.com/v1/origin',
        aud: 'app_test',
        sub: 'user_test',
        email: 'ada@example.com',
        exp: Math.floor(Date.now() / 1000) + 120,
        jti: 'jti-cursor-1',
        state,
      }),
    ).toString('base64url');
    const signature = sign(null, Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
    const callback = await fetch(
      `${origin}/remote/oauth/callback?confirmation_receipt=${encodeURIComponent(`${header}.${payload}.${signature}`)}&state=${state}`,
    );
    expect(callback.status).toBe(200);
    const result = await fetch(`${origin}/remote/oauth/result?state=${state}`);
    const session = (await result.json()) as { email?: string; credential?: string };
    expect(session.email).toBe('ada@example.com');
    expect(session.credential).toBeTruthy();
  });

  it('signs in with Entire at the regional issuer', async () => {
    handle = await startRelayServer({
      skipSocketMode: true,
      host: '127.0.0.1',
      port: 0,
      accountsPath,
      relayOAuth: { entire: { clientId: 'entire-app' } },
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url === 'https://eu.auth.entire.io/oauth/token') {
          const raw = typeof init?.body === 'string' ? init.body : String(init?.body ?? '');
          const params = new URLSearchParams(raw);
          if (params.get('grant_type') !== 'authorization_code') throw new Error('missing grant');
          if (params.get('code') !== 'from-entire') throw new Error('missing code');
          if (!params.get('code_verifier')) throw new Error('missing pkce');
          if (params.get('client_id') !== 'entire-app') throw new Error('missing client');
          const auth = new Headers(init?.headers).get('authorization');
          if (auth) throw new Error(`public client sent authorization ${auth}`);
          return new Response(JSON.stringify({ access_token: 'entire-access' }));
        }
        if (url === 'https://eu.auth.entire.io/userinfo') {
          const auth = new Headers(init?.headers).get('authorization');
          if (auth !== 'Bearer entire-access') throw new Error('bad bearer');
          return new Response(
            JSON.stringify({
              sub: 'user_entire',
              email: 'ada@example.com',
              email_verified: true,
            }),
          );
        }
        throw new Error(`unexpected fetch ${url}`);
      },
    });
    const origin = `http://127.0.0.1:${handle.port}`;
    const state = 'e'.repeat(32);
    const started = await fetch(`${origin}/remote/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'entire', state }),
    });
    const startBody = (await started.json()) as { url?: string };
    const authorize = new URL(startBody.url ?? '');
    expect(authorize.origin).toBe('https://auth.entire.io');
    expect(authorize.searchParams.get('client_id')).toBe('entire-app');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorize.search).not.toContain('secret');
    const callback = await fetch(
      `${origin}/remote/oauth/callback?code=from-entire&state=${state}&iss=${encodeURIComponent('https://eu.auth.entire.io')}`,
    );
    expect(callback.status).toBe(200);
    const result = await fetch(`${origin}/remote/oauth/result?state=${state}`);
    const session = (await result.json()) as { email?: string; credential?: string };
    expect(session.email).toBe('ada@example.com');
    expect(session.credential).toBeTruthy();

    const rejected = 'f'.repeat(32);
    const again = await fetch(`${origin}/remote/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'entire', state: rejected }),
    });
    expect(again.ok).toBe(true);
    const bad = await fetch(
      `${origin}/remote/oauth/callback?code=nope&state=${rejected}&iss=${encodeURIComponent('https://evil.example')}`,
    );
    expect(bad.status).toBe(400);
    const badResult = (await (await fetch(`${origin}/remote/oauth/result?state=${rejected}`)).json()) as {
      ok?: boolean;
    };
    expect(badResult.ok).toBe(false);
  });
});
