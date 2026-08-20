import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDataDir } from './paths.js';

/** Written by the desktop Electron process so MCP/CLI can defer drain to it. */
export function desktopHostPidPath(): string {
  return join(appDataDir(), 'desktop-host.pid');
}

export function claimDesktopHost(pid = process.pid): void {
  writeFileSync(desktopHostPidPath(), `${pid}\n`, 'utf8');
}

export function releaseDesktopHost(pid = process.pid): void {
  if (readDesktopHostPid() !== pid) return;
  try {
    unlinkSync(desktopHostPidPath());
  } catch {
    // Already gone.
  }
}

export function readDesktopHostPid(): number | null {
  try {
    const pid = Number.parseInt(readFileSync(desktopHostPidPath(), 'utf8').trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isDesktopHostAlive(): boolean {
  const pid = readDesktopHostPid();
  return pid != null && pidAlive(pid);
}

export function isThisProcessDesktopHost(): boolean {
  return readDesktopHostPid() === process.pid && pidAlive(process.pid);
}

/**
 * MCP/CLI must not spawn worktree turns when the board is running — those
 * children have no renderer IPC, so the chat stays blank, and Stop/Send now
 * in the desktop cannot see `activeTurns`. Desktop adopts persisted queues.
 */
export function thisProcessShouldDrainAgentQueues(): boolean {
  if (isThisProcessDesktopHost()) return true;
  return !isDesktopHostAlive();
}
