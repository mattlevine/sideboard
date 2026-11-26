import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { postComputerUseBridge, readComputerUseBridge } from '@sideboard-ai/core';
import { closeComputerUseBridge, listenComputerUseBridge } from './computer-use-server';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('computer use bridge server', () => {
  it('rejects a bad token and posts a valid click', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cu-server-'));
    dirs.push(dir);
    const file = join(dir, 'computer-use-bridge.json');
    const seen: unknown[] = [];
    const running = await listenComputerUseBridge(
      {
        postEvent(event) {
          seen.push(event);
        },
        async capturePng() {
          return { png: Buffer.from('not-a-png-but-long-enough!!'), scale: 2 };
        },
      },
      file,
    );
    const info = readComputerUseBridge(file);
    expect(info?.port).toBe(running.port);
    const denied = await fetch(`http://127.0.0.1:${running.port}/v1/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer nope' },
      body: JSON.stringify({ type: 'click', x: 1, y: 2 }),
    });
    expect(denied.status).toBe(403);
    expect(seen).toEqual([]);
    expect(await postComputerUseBridge({ type: 'click', x: 8, y: 9 }, file)).toBe(true);
    expect(seen).toEqual([{ type: 'click', x: 8, y: 9 }]);
    const shot = await fetch(`http://127.0.0.1:${running.port}/v1/screenshot`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info?.token}` },
    });
    expect(shot.headers.get('x-sideboard-scale')).toBe('2');
    expect(Buffer.from(await shot.arrayBuffer()).toString()).toBe('not-a-png-but-long-enough!!');
    closeComputerUseBridge(running, file);
    expect(readComputerUseBridge(file)).toBeNull();
  });
});
