import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export function appDataDir(): string {
  const base =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'sideboard')
      : process.platform === 'win32'
        ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'sideboard')
        : join(homedir(), '.local', 'share', 'sideboard');
  mkdirSync(base, { recursive: true });
  return base;
}

export function threadsDir(): string {
  const dir = join(appDataDir(), 'threads');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function locksDir(): string {
  const dir = join(appDataDir(), 'locks');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function worktreesRoot(repoPath: string): string {
  const dir = join(repoPath, '.sideboard', 'worktrees');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function threadFilePath(id: string): string {
  return join(threadsDir(), `${id}.json`);
}

export function threadLockPath(id: string): string {
  return join(locksDir(), `${id}.lock`);
}
