import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cgScrollWheels,
  computerUseBridgePath,
  fetchComputerUseScreenshot,
  parseComputerUseInput,
  postComputerUseBridge,
} from './bridge.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cu-bridge-'));
  dirs.push(dir);
  return join(dir, 'computer-use-bridge.json');
}

describe('computer use bridge client', () => {
  it('stores the bridge file in Sideboard app data', () => {
    expect(computerUseBridgePath().endsWith('computer-use-bridge.json')).toBe(true);
  });

  it('parses events and rejects anything the desktop process should not post', () => {
    expect(parseComputerUseInput({ type: 'click', x: 10, y: 21 })).toEqual({
      type: 'click',
      x: 10,
      y: 21,
    });
    expect(parseComputerUseInput({ type: 'click', x: 10.2, y: 1 })).toBeNull();
    expect(parseComputerUseInput({ type: 'scroll', x: 1, y: 2, dx: 0, dy: 0 })).toBeNull();
    expect(parseComputerUseInput({ type: 'key', key: 'return', modifiers: ['command'] })).toEqual({
      type: 'key',
      key: 'return',
      modifiers: ['command'],
    });
    expect(cgScrollWheels(40, 80)).toEqual({ wheel1: -80, wheel2: -40 });
  });

  it('returns false when the desktop app is not listening', async () => {
    expect(await postComputerUseBridge({ type: 'click', x: 1, y: 2 }, tempFile())).toBe(false);
  });

  it('posts with the bearer token and surfaces the app error', async () => {
    const file = tempFile();
    const seen: { auth?: string; body?: unknown } = {};
    const server = createServer((req, res) => {
      seen.auth = req.headers.authorization;
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        seen.body = JSON.parse(body);
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Allow Sideboard to control this Mac.' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    writeFileSync(file, JSON.stringify({ port: address.port, token: 'a'.repeat(32) }), {
      mode: 0o600,
    });
    await expect(postComputerUseBridge({ type: 'click', x: 3, y: 4 }, file)).rejects.toThrow(
      /Allow Sideboard/,
    );
    expect(seen.auth).toBe(`Bearer ${'a'.repeat(32)}`);
    expect(seen.body).toEqual({ type: 'click', x: 3, y: 4 });
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it('reads a screenshot from the desktop app', async () => {
    const file = tempFile();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6]);
    const server = createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'image/png',
        'x-sideboard-scale': '2',
      });
      res.end(png);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    writeFileSync(file, JSON.stringify({ port: address.port, token: 'b'.repeat(32) }));
    const shot = await fetchComputerUseScreenshot(file);
    expect(shot?.scale).toBe(2);
    expect(shot?.png.equals(png)).toBe(true);
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });
});
