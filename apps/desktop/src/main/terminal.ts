import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { BrowserWindow } from 'electron';
import type { Orchestrator } from '@sideboard/core';

interface PtyLike {
  write: (data: string) => void;
  resize?: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number | null }) => void) => void;
}

interface PtySession {
  id: string;
  threadRef: string;
  pty: PtyLike;
}

const sessions = new Map<string, PtySession>();

function resolveShell(): string {
  const fromEnv = process.env.SHELL?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync('/bin/zsh')) return '/bin/zsh';
  if (existsSync('/bin/bash')) return '/bin/bash';
  return '/bin/sh';
}

async function loadNodePty(): Promise<{
  spawn: (
    file: string,
    args: string[] | string,
    opts: Record<string, unknown>,
  ) => PtyLike & { pid: number };
} | null> {
  try {
    const mod = await import('node-pty');
    return mod as never;
  } catch (err) {
    console.warn('[terminal] node-pty unavailable:', err);
    return null;
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

function spawnPipeShell(
  file: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): PtyLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawn } = require('node:child_process') as typeof import('node:child_process');
  const child = spawn(file, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    write: (data: string) => {
      child.stdin?.write(data);
    },
    resize: () => undefined,
    kill: () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    },
    onData: (cb) => {
      child.stdout?.on('data', (buf: Buffer) => cb(buf.toString('utf8')));
      child.stderr?.on('data', (buf: Buffer) => cb(buf.toString('utf8')));
    },
    onExit: (cb) => {
      child.on('exit', (code) => cb({ exitCode: code }));
    },
  };
}

/**
 * macOS `script` allocates a real PTY without native node-pty bindings.
 * Useful when node-pty's Electron ABI rebuild is missing or spawn fails.
 */
function spawnScriptPty(
  file: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): PtyLike | null {
  if (process.platform !== 'darwin') return null;
  if (!existsSync('/usr/bin/script')) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawn } = require('node:child_process') as typeof import('node:child_process');
  // script -q /dev/null <cmd...> — quiet, no typescript file, real PTY
  const child = spawn(
    '/usr/bin/script',
    ['-q', '/dev/null', file, ...args],
    {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  return {
    write: (data: string) => {
      child.stdin?.write(data);
    },
    resize: () => undefined,
    kill: () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    },
    onData: (cb) => {
      child.stdout?.on('data', (buf: Buffer) => cb(buf.toString('utf8')));
      child.stderr?.on('data', (buf: Buffer) => cb(buf.toString('utf8')));
    },
    onExit: (cb) => {
      child.on('exit', (code) => cb({ exitCode: code }));
    },
  };
}

function bindSession(id: string, threadRef: string, pty: PtyLike): void {
  pty.onData((data) => broadcast('terminal:data', { id, data }));
  pty.onExit(({ exitCode }) => {
    sessions.delete(id);
    broadcast('terminal:exit', { id, exitCode });
  });
  sessions.set(id, { id, threadRef, pty });
}

export async function startTerminalSession(
  orch: Orchestrator,
  threadRef: string,
  cols = 80,
  rows = 24,
  opts?: { command?: string; args?: string[] },
): Promise<{ id: string }> {
  const thread = orch.getThread(threadRef);
  if (!thread) throw new Error(`Thread not found: ${threadRef}`);

  const id = randomUUID();
  const shell = resolveShell();
  const file = opts?.command ?? shell;
  const args =
    opts?.args ??
    (file === shell && process.platform === 'darwin' ? ['-l'] : []);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };

  // 1) Prefer node-pty (real PTY). Catch spawn failures (ABI / posix_spawnp).
  const ptyMod = await loadNodePty();
  if (ptyMod) {
    try {
      const pty = ptyMod.spawn(file, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: thread.worktreePath,
        env,
      });
      bindSession(id, threadRef, pty);
      return { id };
    } catch (err) {
      console.warn('[terminal] node-pty spawn failed, trying fallbacks:', err);
    }
  }

  // 2) macOS script(1) — allocates a PTY without native addons
  const scriptPty = spawnScriptPty(file, args, thread.worktreePath, env);
  if (scriptPty) {
    bindSession(id, threadRef, scriptPty);
    return { id };
  }

  // 3) Last resort: plain pipes (limited interactivity)
  const pipe = spawnPipeShell(file, args, thread.worktreePath, env);
  bindSession(id, threadRef, pipe);
  return { id };
}

export function writeTerminal(id: string, data: string): void {
  const session = sessions.get(id);
  if (!session) throw new Error(`Terminal session not found: ${id}`);
  session.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session) return;
  session.pty.resize?.(cols, rows);
}

export function killTerminal(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  try {
    session.pty.kill();
  } catch {
    // ignore
  }
  sessions.delete(id);
}

export function killTerminalsForThread(threadRef: string): void {
  for (const [id, session] of sessions) {
    if (session.threadRef === threadRef) {
      killTerminal(id);
    }
  }
}
