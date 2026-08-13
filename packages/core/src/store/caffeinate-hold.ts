import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { appDataDir } from './paths.js';
import { writePrivateFile } from './private-file.js';

export interface CaffeinateHoldState {
  held: boolean;
  pid: number | null;
  running: boolean;
  platform: NodeJS.Platform;
}

type HoldFile = { pid: number };

export interface CaffeinateHoldHooks {
  spawn?: typeof spawn;
  processAlive?: (pid: number) => boolean;
  kill?: (pid: number) => void;
  platform?: NodeJS.Platform;
}

let hooks: CaffeinateHoldHooks = {};

/** Test injection. */
export function setCaffeinateHoldHooks(next: CaffeinateHoldHooks): void {
  hooks = next;
}

export function caffeinateHoldPath(): string {
  return join(appDataDir(), 'caffeinate-hold.json');
}

function processAlive(pid: number): boolean {
  if (hooks.processAlive) return hooks.processAlive(pid);
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid: number): void {
  if (hooks.kill) {
    hooks.kill(pid);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

function readHold(): HoldFile | null {
  const path = caffeinateHoldPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HoldFile;
    if (typeof parsed?.pid === 'number' && parsed.pid > 0) return parsed;
  } catch {
    // ignore
  }
  return null;
}

function writeHold(pid: number): void {
  writePrivateFile(caffeinateHoldPath(), `${JSON.stringify({ pid })}\n`);
}

function clearHold(): void {
  try {
    unlinkSync(caffeinateHoldPath());
  } catch {
    // ignore
  }
}

export function getCaffeinateHold(): CaffeinateHoldState {
  const platform = hooks.platform ?? process.platform;
  const hold = readHold();
  if (!hold) {
    return { held: false, pid: null, running: false, platform };
  }
  const running = processAlive(hold.pid);
  if (!running) {
    clearHold();
    return { held: false, pid: null, running: false, platform };
  }
  return { held: true, pid: hold.pid, running: true, platform };
}

/**
 * Session hold so the Mac stays awake across orchestration turns (MCP
 * processes exit). Detached `caffeinate` on macOS; no-op elsewhere.
 */
export function setCaffeinateHold(enabled: boolean): CaffeinateHoldState {
  const platform = hooks.platform ?? process.platform;
  const current = getCaffeinateHold();

  if (!enabled) {
    if (current.pid) killPid(current.pid);
    clearHold();
    return { held: false, pid: null, running: false, platform };
  }

  if (current.running && current.pid) return current;

  if (platform !== 'darwin') {
    return { held: false, pid: null, running: false, platform };
  }

  const spawnImpl = hooks.spawn ?? spawn;
  const child: ChildProcess = spawnImpl('caffeinate', ['-dimsu'], {
    detached: true,
    stdio: 'ignore',
  });
  const pid = child.pid;
  if (!pid) {
    try {
      child.kill();
    } catch {
      // ignore
    }
    return { held: false, pid: null, running: false, platform };
  }
  child.unref();
  writeHold(pid);
  return { held: true, pid, running: true, platform };
}
