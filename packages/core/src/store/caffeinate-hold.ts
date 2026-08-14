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
  /** Orchestration thread ids that requested this hold. */
  threadIds: string[];
}

type HoldFile = { pid: number; threadIds?: string[] };

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

function uniqueIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function readHold(): HoldFile | null {
  const path = caffeinateHoldPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HoldFile;
    if (typeof parsed?.pid === 'number' && parsed.pid > 0) {
      return {
        pid: parsed.pid,
        threadIds: uniqueIds(
          Array.isArray(parsed.threadIds)
            ? parsed.threadIds.filter((id): id is string => typeof id === 'string')
            : [],
        ),
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function writeHold(pid: number, threadIds: string[]): void {
  writePrivateFile(
    caffeinateHoldPath(),
    `${JSON.stringify({ pid, threadIds: uniqueIds(threadIds) })}\n`,
  );
}

function clearHold(): void {
  try {
    unlinkSync(caffeinateHoldPath());
  } catch {
    // ignore
  }
}

function idleState(platform: NodeJS.Platform): CaffeinateHoldState {
  return { held: false, pid: null, running: false, platform, threadIds: [] };
}

export function getCaffeinateHold(): CaffeinateHoldState {
  const platform = hooks.platform ?? process.platform;
  const hold = readHold();
  if (!hold) return idleState(platform);
  const running = processAlive(hold.pid);
  if (!running) {
    clearHold();
    return idleState(platform);
  }
  return {
    held: true,
    pid: hold.pid,
    running: true,
    platform,
    threadIds: hold.threadIds ?? [],
  };
}

function stopHold(platform: NodeJS.Platform, pid: number | null): CaffeinateHoldState {
  if (pid) killPid(pid);
  clearHold();
  return idleState(platform);
}

/**
 * Session hold so the Mac stays awake across orchestration turns (MCP
 * processes exit). Detached `caffeinate` on macOS; no-op elsewhere.
 * Pass `threadId` so closing that orchestration chat can release the hold.
 */
export function setCaffeinateHold(
  enabled: boolean,
  opts?: { threadId?: string | null },
): CaffeinateHoldState {
  const platform = hooks.platform ?? process.platform;
  const current = getCaffeinateHold();
  const threadId = opts?.threadId?.trim() || '';

  if (!enabled) {
    if (threadId && current.threadIds.length > 0) {
      const remaining = current.threadIds.filter((id) => id !== threadId);
      if (remaining.length > 0 && current.pid) {
        writeHold(current.pid, remaining);
        return { ...current, threadIds: remaining };
      }
    }
    return stopHold(platform, current.pid);
  }

  const threadIds = threadId
    ? uniqueIds([...current.threadIds, threadId])
    : current.threadIds;

  if (current.running && current.pid) {
    writeHold(current.pid, threadIds);
    return { ...current, threadIds };
  }

  if (platform !== 'darwin') {
    return idleState(platform);
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
    return idleState(platform);
  }
  child.unref();
  writeHold(pid, threadIds);
  return { held: true, pid, running: true, platform, threadIds };
}

/**
 * Drop a closed orchestration chat from the hold. Kills caffeinate when no
 * other chats still want it. A legacy hold with no thread ids is treated as
 * belonging to this chat (the usual one-orchestrator case).
 */
export function releaseCaffeinateHoldForThread(threadId: string): CaffeinateHoldState {
  const id = threadId.trim();
  if (!id) return getCaffeinateHold();
  const current = getCaffeinateHold();
  if (!current.held) return current;
  if (current.threadIds.length > 0 && !current.threadIds.includes(id)) {
    return current;
  }
  return setCaffeinateHold(false, { threadId: id });
}
