import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDataDir } from '../store/paths.js';

/**
 * Desktop Electron listens on 127.0.0.1 and writes this file mode 0600
 * next to the other Sideboard app data. The MCP process is not the app, so
 * it cannot post CGEvents under Sideboard's permission. A local process
 * running as the user can read the token; that is the same trust as
 * Accessibility once it is granted.
 */
export function computerUseBridgePath(): string {
  return join(appDataDir(), 'computer-use-bridge.json');
}

export type ComputerUseBridgeInfo = { port: number; token: string };

export type ComputerUseInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'key'; key: string; modifiers: string[] }
  | { type: 'scroll'; x: number; y: number; dx: number; dy: number };

const MODIFIERS = new Set(['command', 'cmd', 'shift', 'option', 'alt', 'control', 'ctrl']);

export function readComputerUseBridge(
  file = computerUseBridgePath(),
): ComputerUseBridgeInfo | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { port?: unknown; token?: unknown };
    if (typeof raw.port !== 'number' || !Number.isInteger(raw.port)) return null;
    if (raw.port < 1 || raw.port > 65535) return null;
    if (typeof raw.token !== 'string' || raw.token.length < 16) return null;
    return { port: raw.port, token: raw.token };
  } catch {
    return null;
  }
}

function intIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

export function parseComputerUseInput(value: unknown): ComputerUseInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (rec.type === 'click') {
    const x = intIn(rec.x, -8000, 20000);
    const y = intIn(rec.y, -8000, 20000);
    if (x === null || y === null) return null;
    return { type: 'click', x, y };
  }
  if (rec.type === 'type') {
    if (typeof rec.text !== 'string' || !rec.text || rec.text.length > 2000) return null;
    return { type: 'type', text: rec.text };
  }
  if (rec.type === 'key') {
    if (typeof rec.key !== 'string' || !rec.key || rec.key.length > 32) return null;
    if (!Array.isArray(rec.modifiers) || rec.modifiers.length > 4) return null;
    const modifiers: string[] = [];
    for (const item of rec.modifiers) {
      if (typeof item !== 'string' || !MODIFIERS.has(item)) return null;
      modifiers.push(item);
    }
    return { type: 'key', key: rec.key, modifiers };
  }
  if (rec.type === 'scroll') {
    const x = intIn(rec.x, -8000, 20000);
    const y = intIn(rec.y, -8000, 20000);
    const dx = intIn(rec.dx, -4000, 4000);
    const dy = intIn(rec.dy, -4000, 4000);
    if (x === null || y === null || dx === null || dy === null) return null;
    if (dx === 0 && dy === 0) return null;
    return { type: 'scroll', x, y, dx, dy };
  }
  return null;
}

/** CGEventFlags masks for the modifiers the key action accepts. */
export function cgModifierFlags(modifiers: string[]): number {
  let flags = 0;
  for (const name of modifiers) {
    if (name === 'shift') flags |= 0x00020000;
    else if (name === 'ctrl' || name === 'control') flags |= 0x00040000;
    else if (name === 'alt' || name === 'option') flags |= 0x00080000;
    else if (name === 'cmd' || name === 'command') flags |= 0x00100000;
  }
  return flags;
}

/** Positive dx/dy are right/down. CGEvent wheel1 positive scrolls up. */
export function cgScrollWheels(dx: number, dy: number): { wheel1: number; wheel2: number } {
  return { wheel1: -dy, wheel2: -dx };
}

const MODIFIER_KEY_CODES: Record<string, number> = {
  command: 55,
  cmd: 55,
  shift: 56,
  option: 58,
  alt: 58,
  control: 59,
  ctrl: 59,
};

export function modifierKeyCode(name: string): number | null {
  const code = MODIFIER_KEY_CODES[name];
  return code === undefined ? null : code;
}

async function bridgeError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // ignore
  }
  return `computer use bridge returned ${res.status}`;
}

async function bridgeFetch(
  info: ComputerUseBridgeInfo,
  path: string,
  init: RequestInit,
): Promise<Response | null> {
  try {
    return await fetch(`http://127.0.0.1:${info.port}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${info.token}`,
        ...init.headers,
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return null;
  }
}

/** True when Sideboard posted the event. False when the bridge is not running. */
export async function postComputerUseBridge(
  event: ComputerUseInput,
  file = computerUseBridgePath(),
): Promise<boolean> {
  const info = readComputerUseBridge(file);
  if (!info) return false;
  const res = await bridgeFetch(info, '/v1/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (!res) return false;
  if (!res.ok) throw new Error(await bridgeError(res));
  return true;
}

/** PNG bytes from the desktop app, or null when the bridge is not running. */
export async function fetchComputerUseScreenshot(
  file = computerUseBridgePath(),
): Promise<{ png: Buffer; scale: number } | null> {
  const info = readComputerUseBridge(file);
  if (!info) return null;
  const res = await bridgeFetch(info, '/v1/screenshot', { method: 'POST' });
  if (!res) return null;
  if (!res.ok) throw new Error(await bridgeError(res));
  const png = Buffer.from(await res.arrayBuffer());
  if (png.length < 24) throw new Error('screen capture was empty');
  const header = Number(res.headers.get('x-sideboard-scale'));
  return { png, scale: Number.isFinite(header) && header > 0 ? header : 1 };
}
