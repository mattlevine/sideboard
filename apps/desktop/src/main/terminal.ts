import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { BrowserWindow } from 'electron';
import {
  normalizeWorktreePath,
  stripNestedElectronEnv,
  threadsSharingWorktree,
  type Orchestrator,
} from '@sideboard-ai/core';
import {
  appendTerminalScrollback,
  findReusableTerminalSession,
  shouldApplyPtyResize,
  shouldResizeExistingTerminalOnStart,
  shouldTeardownTerminalSession,
  teardownInputAfterArchive,
  terminalReuseKey,
  terminalSessionKind,
  type TerminalSessionKind,
} from './terminal-session.js';

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
  worktreeKey: string;
  reuseKey: string;
  kind: TerminalSessionKind;
  pty: PtyLike;
  scrollback: string;
  cols: number;
  rows: number;
}

const sessions = new Map<string, PtySession>();
/** In-flight starts so overlapping remounts share one PTY per worktree shell (or chat attach). */
const starting = new Map<string, Promise<{ id: string; scrollback: string }>>();

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

function applySessionResize(session: PtySession, cols: number, rows: number): void {
  if (!shouldApplyPtyResize({ cols: session.cols, rows: session.rows }, { cols, rows })) {
    return;
  }
  session.cols = cols;
  session.rows = rows;
  session.pty.resize?.(cols, rows);
}

function bindSession(
  id: string,
  threadRef: string,
  worktreeKey: string,
  reuseKey: string,
  kind: TerminalSessionKind,
  pty: PtyLike,
  cols: number,
  rows: number,
): void {
  const session: PtySession = {
    id,
    threadRef,
    worktreeKey,
    reuseKey,
    kind,
    pty,
    scrollback: '',
    cols,
    rows,
  };
  pty.onData((data) => {
    session.scrollback = appendTerminalScrollback(session.scrollback, data);
    broadcast('terminal:data', { id, data });
  });
  pty.onExit(({ exitCode }) => {
    sessions.delete(id);
    broadcast('terminal:exit', { id, exitCode });
  });
  sessions.set(id, session);
}

export async function startTerminalSession(
  orch: Orchestrator,
  threadRef: string,
  cols = 80,
  rows = 24,
  opts?: { command?: string; args?: string[] },
): Promise<{ id: string; scrollback: string }> {
  const thread = orch.getThread(threadRef);
  if (!thread) throw new Error(`Thread not found: ${threadRef}`);

  const kind = terminalSessionKind(opts);
  const worktreeKey = normalizeWorktreePath(thread.worktreePath) || threadRef;
  const reuseKey = terminalReuseKey(kind, worktreeKey, threadRef);
  const existing = findReusableTerminalSession(sessions.values(), reuseKey, kind);
  if (existing) {
    // Do not ioctl with bootstrap cols/rows — see shouldResizeExistingTerminalOnStart.
    if (shouldResizeExistingTerminalOnStart()) {
      applySessionResize(existing, cols, rows);
    }
    return { id: existing.id, scrollback: existing.scrollback };
  }

  const inflight = starting.get(reuseKey);
  if (inflight) return inflight;

  const started = startNewTerminalSession(
    thread,
    threadRef,
    worktreeKey,
    reuseKey,
    kind,
    cols,
    rows,
    opts,
  ).finally(() => {
    if (starting.get(reuseKey) === started) starting.delete(reuseKey);
  });
  starting.set(reuseKey, started);
  return started;
}

async function startNewTerminalSession(
  thread: { worktreePath: string },
  threadRef: string,
  worktreeKey: string,
  reuseKey: string,
  kind: TerminalSessionKind,
  cols: number,
  rows: number,
  opts?: { command?: string; args?: string[] },
): Promise<{ id: string; scrollback: string }> {
  const reused = findReusableTerminalSession(sessions.values(), reuseKey, kind);
  if (reused) {
    if (shouldResizeExistingTerminalOnStart()) {
      applySessionResize(reused, cols, rows);
    }
    return { id: reused.id, scrollback: reused.scrollback };
  }

  const id = randomUUID();
  const shell = resolveShell();
  const file = opts?.command ?? shell;
  const args =
    opts?.args ??
    (file === shell && process.platform === 'darwin' ? ['-l'] : []);
  const env: NodeJS.ProcessEnv = {
    ...stripNestedElectronEnv(process.env),
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
      bindSession(id, threadRef, worktreeKey, reuseKey, kind, pty, cols, rows);
      return { id, scrollback: '' };
    } catch (err) {
      console.warn('[terminal] node-pty spawn failed, trying fallbacks:', err);
    }
  }

  // 2) macOS script(1) — allocates a PTY without native addons
  const scriptPty = spawnScriptPty(file, args, thread.worktreePath, env);
  if (scriptPty) {
    bindSession(id, threadRef, worktreeKey, reuseKey, kind, scriptPty, cols, rows);
    return { id, scrollback: '' };
  }

  // 3) Last resort: plain pipes (limited interactivity)
  const pipe = spawnPipeShell(file, args, thread.worktreePath, env);
  bindSession(id, threadRef, worktreeKey, reuseKey, kind, pipe, cols, rows);
  return { id, scrollback: '' };
}

export function snapshotTerminal(id: string): string {
  return sessions.get(id)?.scrollback ?? '';
}

export function writeTerminal(id: string, data: string): void {
  const session = sessions.get(id);
  if (!session) throw new Error(`Terminal session not found: ${id}`);
  session.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session) return;
  applySessionResize(session, cols, rows);
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

export function killTerminalsForThread(
  threadRef: string,
  opts?: { worktreeKey?: string; lastWorktreeChat?: boolean },
): void {
  const worktreeKey = opts?.worktreeKey ?? '';
  const lastWorktreeChat = opts?.lastWorktreeChat ?? !worktreeKey;
  for (const [id, session] of sessions) {
    if (
      shouldTeardownTerminalSession(session, {
        threadRef,
        worktreeKey,
        lastWorktreeChat,
      })
    ) {
      killTerminal(id);
    }
  }
}

/**
 * Archive/purge: kill attach for this chat; kill the shared shell only if last tab.
 * Call *after* `orch.archive` / `orch.purge` resolve — they serialize per
 * worktree, so siblings closed together are already archived by then. Deciding
 * before the call made every parallel close look like "not last" and leaked
 * the PTY (Bugbot, #118).
 */
export function killTerminalsAfterThreadTeardown(
  threadRef: string,
  worktreePath: string | null | undefined,
): void {
  if (!worktreePath) {
    killTerminalsForThread(threadRef);
    return;
  }
  const worktreeKey = normalizeWorktreePath(worktreePath);
  const live = threadsSharingWorktree(worktreePath).map((t) => t.id);
  const { lastWorktreeChat } = teardownInputAfterArchive(threadRef, worktreeKey, live);
  killTerminalsForThread(threadRef, { worktreeKey, lastWorktreeChat });
}

/** Snapshot before teardown: purge deletes the record so the path is gone afterwards. */
export function threadWorktreePathForTeardown(
  orch: Orchestrator,
  threadRef: string,
): string | null {
  return orch.getThread(threadRef)?.worktreePath ?? null;
}
