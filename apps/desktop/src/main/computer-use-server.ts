import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import {
  computerUseBridgePath,
  parseComputerUseInput,
  readComputerUseBridge,
  type ComputerUseInput,
} from '@sideboard-ai/core';

export type ComputerUseBridgeHandlers = {
  postEvent: (event: ComputerUseInput) => void;
  capturePng: () => Promise<{ png: Buffer; scale: number }>;
};

export type RunningComputerUseBridge = { server: Server; port: number };

function loopback(req: IncomingMessage): boolean {
  const ip = req.socket.remoteAddress;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer | string) => {
      body += chunk;
      if (body.length > limit) {
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Localhost bridge so the MCP process can ask the Electron app to post
 * CGEvents. The token file is mode 0600. Bind is 127.0.0.1 only.
 */
export function listenComputerUseBridge(
  handlers: ComputerUseBridgeHandlers,
  bridgeFile = computerUseBridgePath(),
): Promise<RunningComputerUseBridge> {
  const token = randomBytes(32).toString('hex');
  const server = createServer((req, res) => {
    void handle(req, res, token, handlers);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('computer use bridge has no port'));
        return;
      }
      try {
        mkdirSync(dirname(bridgeFile), { recursive: true });
        const tmp = `${bridgeFile}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify({ port: address.port, token }), { mode: 0o600 });
        chmodSync(tmp, 0o600);
        renameSync(tmp, bridgeFile);
        chmodSync(bridgeFile, 0o600);
      } catch (err) {
        server.close();
        reject(err);
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  handlers: ComputerUseBridgeHandlers,
): Promise<void> {
  try {
    if (!loopback(req) || req.headers.authorization !== `Bearer ${token}`) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (req.url === '/v1/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.url === '/v1/screenshot') {
      const shot = await handlers.capturePng();
      res.writeHead(200, {
        'content-type': 'image/png',
        'x-sideboard-scale': String(shot.scale),
      });
      res.end(shot.png);
      return;
    }
    if (req.url !== '/v1/event') {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const raw = await readBody(req, 8000);
    const event = parseComputerUseInput(JSON.parse(raw) as unknown);
    if (!event) {
      sendJson(res, 400, { error: 'invalid computer use event' });
      return;
    }
    handlers.postEvent(event);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'computer use bridge failed';
    if (!res.headersSent) sendJson(res, 400, { error: message });
  }
}

/**
 * Close this server. Dev and the installed app share one bridge file, so
 * unlink it only when it still names this port.
 */
export function closeComputerUseBridge(
  running: RunningComputerUseBridge | null,
  bridgeFile = computerUseBridgePath(),
): void {
  const port = running?.port;
  running?.server.close();
  if (port == null) return;
  try {
    if (readComputerUseBridge(bridgeFile)?.port !== port) return;
    unlinkSync(bridgeFile);
  } catch {
    // already gone
  }
}
