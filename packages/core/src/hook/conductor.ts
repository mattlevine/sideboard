import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { execa, type ResultPromise } from 'execa';
import { createInterface } from 'node:readline';
import {
  hasConductorHook,
  hasRepoHook,
  hasWorkspaceHook,
  loadConductorSettings,
  loadRepoSettings,
  loadWorkspaceSettings,
  settingsSourceLabel,
  workspaceSettingsSourceLabel,
  type RepoSettings,
  type RunScript,
} from './settings.js';
import { stripNestedElectronEnv } from './nested-electron-env.js';
import { applyWorktreePkgCacheEnv } from './worktree-pkg-cache.js';
import { findConventionSetup } from './convention-setup.js';
import { runCursorWorktreeSetup } from './cursor-worktrees.js';
import { mergeAgentGitAuthEnv, resolveAgentGitAuthEnv } from '../git/git-auth-mode.js';
import { ensureReviewGuidelinesFile } from '../review/request-review.js';
import { ensureWorktreeSideboardIgnored } from '../git/worktree-exclude.js';
import {
  loadWorktreeRunPorts,
  saveWorktreeRunPorts,
} from './worktree-run-ports.js';

export {
  loadWorktreeRunPorts,
  saveWorktreeRunPorts,
  worktreeRunPortsPath,
  RUN_PORTS_REL,
} from './worktree-run-ports.js';

export type SetupRunResult = {
  ran: boolean;
  exitCode: number | null;
  source: string | null;
  kill?: () => void;
};

export type { RepoSettings, RunScript };
export { stripNestedElectronEnv } from './nested-electron-env.js';
export type ConductorSettings = RepoSettings;
export {
  hasConductorHook,
  hasRepoHook,
  hasWorkspaceHook,
  loadConductorSettings,
  loadRepoSettings,
  loadWorkspaceSettings,
  settingsSourceLabel,
  workspaceSettingsSourceLabel,
};

export const PORT_RANGE_SIZE = 10;
const RECLAIM_RETRY_DELAY_MS = 40;
const RECLAIM_TRIES = 8;

/** Match a simple glob (`*` and `?`) against a basename or relative path. */
function matchSimpleGlob(pattern: string, name: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(name);
}

/**
 * Read `.worktreeinclude` patterns (one per line; `#` comments; blank skipped).
 * Conductor: repo-root file listing gitignored files to copy into each worktree.
 */
export function readWorktreeInclude(repoPath: string): string[] {
  const path = join(repoPath, '.worktreeinclude');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * Resolve files to copy using Conductor order:
 * 1. `.worktreeinclude`
 * 2. settings `filesToCopy` / `file_include_globs`
 * 3. default `.env*`
 */
export function resolveFilesToCopy(repoPath: string): string[] {
  const fromInclude = readWorktreeInclude(repoPath);
  if (fromInclude.length) return fromInclude;

  const settings = loadRepoSettings(repoPath);
  if (settings?.filesToCopy?.length) return settings.filesToCopy;

  if (settings?.fileIncludeGlobs?.length) {
    const matched: string[] = [];
    try {
      for (const entry of readdirSync(repoPath, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        for (const glob of settings.fileIncludeGlobs) {
          if (
            matchSimpleGlob(glob, entry.name) ||
            matchSimpleGlob(basename(glob), entry.name)
          ) {
            matched.push(entry.name);
            break;
          }
        }
      }
    } catch {
      // ignore
    }
    if (matched.length) return [...new Set(matched)];
  }

  // Default: all `.env*` files present at repo root
  const defaults: string[] = [];
  try {
    for (const entry of readdirSync(repoPath, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith('.env')) {
        defaults.push(entry.name);
      }
    }
  } catch {
    // ignore
  }
  if (defaults.length) return defaults;
  return ['.env.local', '.env'];
}

export function copyConfiguredFiles(repoPath: string, worktreePath: string): string[] {
  const patterns = resolveFilesToCopy(repoPath);
  const copied: string[] = [];
  for (const rel of patterns) {
    const src = join(repoPath, rel);
    if (!existsSync(src)) continue;
    const dest = join(worktreePath, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    copied.push(rel);
  }
  return copied;
}

/**
 * Capture a login-shell environment (Conductor-style) so non-interactive
 * scripts see PATH / nvm / asdf / etc. Falls back to `process.env`.
 */
let cachedLoginEnv: NodeJS.ProcessEnv | null = null;

export async function captureLoginEnv(): Promise<NodeJS.ProcessEnv> {
  if (cachedLoginEnv) return { ...cachedLoginEnv };
  const shell =
    process.env.SHELL?.trim() ||
    (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  try {
    const result = await execa(shell, ['-l', '-c', 'env -0'], {
      reject: false,
      timeout: 5_000,
    });
    if (result.exitCode === 0 && result.stdout) {
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const entry of result.stdout.split('\0')) {
        if (!entry) continue;
        const eq = entry.indexOf('=');
        if (eq <= 0) continue;
        const key = entry.slice(0, eq);
        const value = entry.slice(eq + 1);
        if (key) env[key] = value;
      }
      cachedLoginEnv = env;
      return { ...env };
    }
  } catch {
    // fall through
  }
  cachedLoginEnv = { ...process.env };
  return { ...cachedLoginEnv };
}

export interface WorkspaceScriptEnvOpts {
  worktreePath: string;
  repoPath: string;
  workspaceName?: string;
  defaultBranch?: string;
  ports?: number[];
}

/** Build Conductor/Sideboard env vars for setup/run scripts. */
export function buildWorkspaceScriptEnv(
  opts: WorkspaceScriptEnvOpts,
  baseEnv?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = stripNestedElectronEnv({
    ...(baseEnv ?? process.env),
  });
  const name = opts.workspaceName ?? basename(opts.worktreePath);
  const ports = opts.ports ?? [];
  const primary = ports[0];

  env.SIDEBOARD_WORKSPACE_NAME = name;
  env.SIDEBOARD_WORKSPACE_PATH = opts.worktreePath;
  env.SIDEBOARD_ROOT_PATH = opts.repoPath;
  env.SIDEBOARD_IS_LOCAL = '1';
  if (opts.defaultBranch) env.SIDEBOARD_DEFAULT_BRANCH = opts.defaultBranch;

  env.CONDUCTOR_WORKSPACE_NAME = name;
  env.CONDUCTOR_WORKSPACE_PATH = opts.worktreePath;
  env.CONDUCTOR_ROOT_PATH = opts.repoPath;
  env.CONDUCTOR_IS_LOCAL = '1';
  if (opts.defaultBranch) env.CONDUCTOR_DEFAULT_BRANCH = opts.defaultBranch;

  if (primary != null) {
    env.SIDEBOARD_PORT = String(primary);
    env.CONDUCTOR_PORT = String(primary);
    env.PORT = String(primary);
    for (let i = 1; i < ports.length; i++) {
      const p = ports[i]!;
      env[`SIDEBOARD_PORT_${i}`] = String(p);
      env[`CONDUCTOR_PORT_${i}`] = String(p);
    }
  }

  applyWorktreePkgCacheEnv(env, opts.worktreePath);
  return env;
}

function pipeLines(
  stream: NodeJS.ReadableStream | null,
  onLine?: (line: string) => void,
): void {
  if (!stream || !onLine) return;
  const rl = createInterface({ input: stream });
  rl.on('line', onLine);
}

export interface ScriptHandle {
  pid: number | undefined;
  kill: () => void;
  done: Promise<number | null>;
  child: ResultPromise;
}

/** Parse `lsof -ti` output, skipping this process (port reservations listen here). */
export function killableListenerPids(raw: string, selfPid = process.pid): number[] {
  const pids: number[] = [];
  for (const token of raw.trim().split(/\s+/)) {
    const pid = Number(token);
    if (!Number.isFinite(pid) || pid <= 0 || pid === selfPid) continue;
    pids.push(pid);
  }
  return pids;
}

function listUnixListenerPids(port: number, selfPid: number): number[] {
  try {
    const raw = execFileSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    });
    return killableListenerPids(raw, selfPid);
  } catch {
    return [];
  }
}

/** Cwd of a pid via lsof (`-d cwd`). Null when unknown / unavailable. */
export function listenerCwd(pid: number): string | null {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    const raw = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    });
    for (const line of raw.split('\n')) {
      if (line.startsWith('n') && line.length > 1) return line.slice(1);
    }
  } catch {
    // lsof missing, pid exited, or cwd not readable
  }
  return null;
}

function realpathOrResolve(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * True when `cwd` is a sibling Sideboard worktree (same parent dir, other
 * nickname) — do not steal that worktree's live Dev server.
 */
export function isOtherWorktreeListenerCwd(
  cwd: string,
  worktreePath: string,
): boolean {
  const wt = realpathOrResolve(worktreePath);
  const c = realpathOrResolve(cwd);
  if (c === wt || c.startsWith(wt + sep)) return false;
  const parent = dirname(wt);
  const thisName = basename(wt);
  if (!thisName || c === parent) return false;
  if (!c.startsWith(parent + sep)) return false;
  const first = c.slice(parent.length + 1).split(sep)[0];
  return Boolean(first) && first !== thisName;
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // already exited
  }
}

/**
 * Free TCP listeners on ports we allocated for a run script.
 * Used when the in-memory process handle is gone (app restart) or as a
 * backstop when process-group kill leaves grandchildren bound.
 * Uses `lsof`/`process.kill` directly (no login shell) so Stop / quit stay
 * responsive on the Electron main thread.
 * Never signals `process.pid` — reservations listen in this process, and a
 * stale-port reap must not SIGTERM Sideboard (or steal another worktree's hold).
 */
export function killListenersOnPorts(ports: number[]): void {
  const selfPid = process.pid;
  for (const port of ports) {
    if (!Number.isFinite(port) || port <= 0) continue;
    try {
      if (process.platform === 'win32') {
        execFileSync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne ${selfPid} } | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
          ],
          { stdio: 'ignore', timeout: 3_000 },
        );
        continue;
      }
      for (const pid of listUnixListenerPids(port, selfPid)) {
        signalPid(pid, 'SIGTERM');
      }
    } catch {
      // Port already free or tooling unavailable — ignore.
    }
  }
}

/**
 * Reclaim this worktree's assigned ports: kill leftovers from a previous Dev
 * instance, but never another worktree's live server (cwd under a sibling).
 */
export function killStaleWorktreeListeners(
  ports: number[],
  worktreePath: string,
  signal: NodeJS.Signals = 'SIGTERM',
): void {
  if (!worktreePath.trim()) {
    killListenersOnPorts(ports);
    return;
  }
  if (process.platform === 'win32') {
    killListenersOnPorts(ports);
    return;
  }
  const selfPid = process.pid;
  for (const port of ports) {
    if (!Number.isFinite(port) || port <= 0) continue;
    for (const pid of listUnixListenerPids(port, selfPid)) {
      const cwd = listenerCwd(pid);
      if (cwd && isOtherWorktreeListenerCwd(cwd, worktreePath)) continue;
      signalPid(pid, signal);
    }
  }
}

/** Kill a workspace script and its descendants (pnpm → electron-vite → Electron, etc.). */
function killScriptTree(child: ResultPromise, ports: number[] = []): void {
  const pid = child.pid;
  if (pid) {
    try {
      if (process.platform === 'win32') {
        void execa('taskkill', ['/pid', String(pid), '/T', '/F'], { reject: false });
      } else {
        // Negative PID targets the process group created by `detached: true`.
        process.kill(-pid, 'SIGTERM');
        setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            // already exited
          }
        }, 2500).unref?.();
      }
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
  }
  // Backstop: Electron sometimes leaves the shell's process group; free listeners
  // on the ports we allocated for this run.
  killListenersOnPorts(ports);
}

async function spawnWorkspaceScript(
  command: string,
  opts: {
    worktreePath: string;
    repoPath: string;
    ports?: number[];
    heldPorts?: PortReservation[];
    workspaceName?: string;
    defaultBranch?: string;
    onLine?: (line: string) => void;
  },
): Promise<ScriptHandle> {
  const loginEnv = await captureLoginEnv();
  const env = buildWorkspaceScriptEnv(
    {
      worktreePath: opts.worktreePath,
      repoPath: opts.repoPath,
      workspaceName: opts.workspaceName,
      defaultBranch: opts.defaultBranch,
      ports: opts.ports,
    },
    loginEnv,
  );
  // Setup / run scripts often git fetch; they must not pop Keychain on Slack turns.
  try {
    mergeAgentGitAuthEnv(
      env,
      await resolveAgentGitAuthEnv(env, { cwd: opts.worktreePath }),
    );
  } catch {
    /* best-effort — script still runs */
  }

  // Hold SIDEBOARD_PORT across login-env / git-auth awaits; release only now
  // so another worktree Start cannot steal it before execa.
  if (opts.heldPorts?.length) {
    await Promise.all(opts.heldPorts.map((h) => h.release()));
  }

  const shell = process.platform === 'darwin' ? 'zsh' : 'bash';
  const child = execa(shell, ['-lc', command], {
    cwd: opts.worktreePath,
    reject: false,
    env,
    // Own process group so Stop can tear down the whole tree (not just the shell).
    // There is no settings.toml `stop=` / teardown hook for run scripts.
    ...(process.platform === 'win32' ? {} : { detached: true }),
  });

  pipeLines(child.stdout, opts.onLine);
  pipeLines(child.stderr, opts.onLine);

  const ports = opts.ports ?? [];
  return {
    pid: child.pid,
    kill: () => killScriptTree(child, ports),
    done: child.then((r) => r.exitCode ?? null),
    child,
  };
}

async function attachAbort(handle: ScriptHandle, signal?: AbortSignal): Promise<number | null> {
  if (signal) {
    const onAbort = () => handle.kill();
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return handle.done;
}

export async function runSetupScript(
  repoPath: string,
  worktreePath: string,
  onLine?: (line: string) => void,
  opts?: { signal?: AbortSignal; defaultBranch?: string },
): Promise<SetupRunResult> {
  const settings = loadWorkspaceSettings(worktreePath, repoPath);
  if (!settings?.setup) return { ran: false, exitCode: null, source: null };

  const source = workspaceSettingsSourceLabel(worktreePath, repoPath);
  onLine?.(`[setup] ${source ?? 'settings.toml'}`);

  const handle = await spawnWorkspaceScript(settings.setup, {
    worktreePath,
    repoPath,
    defaultBranch: opts?.defaultBranch,
    onLine,
  });

  const exitCode = await attachAbort(handle, opts?.signal);
  return {
    ran: true,
    exitCode,
    source,
    kill: handle.kill,
  };
}

/** Run `script/setup`, `bin/setup`, or `scripts/setup(.sh)` when present. */
export async function runConventionSetup(
  repoPath: string,
  worktreePath: string,
  onLine?: (line: string) => void,
  opts?: { signal?: AbortSignal; defaultBranch?: string },
): Promise<SetupRunResult> {
  const found = findConventionSetup(worktreePath, repoPath);
  if (!found) return { ran: false, exitCode: null, source: null };

  onLine?.(`[setup] ${found.source}`);
  const handle = await spawnWorkspaceScript(found.command, {
    worktreePath,
    repoPath,
    defaultBranch: opts?.defaultBranch,
    onLine,
  });

  const exitCode = await attachAbort(handle, opts?.signal);
  return {
    ran: true,
    exitCode,
    source: found.source,
    kill: handle.kill,
  };
}

/**
 * Setup for a new worktree. When no Claude review skill exists, copies
 * `.sideboard/review.md` into `.context/review.md`, then `[scripts] setup`,
 * Cursor `.cursor/worktrees.json`, then `script/setup`.
 */
export async function runWorkspaceSetup(
  repoPath: string,
  worktreePath: string,
  onLine?: (line: string) => void,
  opts?: { signal?: AbortSignal; defaultBranch?: string },
): Promise<SetupRunResult> {
  await ensureWorktreeSideboardIgnored(worktreePath);
  const review = ensureReviewGuidelinesFile(worktreePath, repoPath);
  if (review.wrote) {
    onLine?.(`[setup] wrote ${review.path} — local Review guidelines`);
  }
  let setup = await runSetupScript(repoPath, worktreePath, onLine, opts);
  if (!setup.ran) {
    setup = await runCursorWorktreeSetup(repoPath, worktreePath, onLine);
  }
  if (!setup.ran) {
    setup = await runConventionSetup(repoPath, worktreePath, onLine, opts);
  }
  return setup;
}

export async function runArchiveScript(
  repoPath: string,
  worktreePath: string,
  onLine?: (line: string) => void,
): Promise<{ ran: boolean; exitCode: number | null }> {
  const settings = loadWorkspaceSettings(worktreePath, repoPath);
  if (!settings?.archive) return { ran: false, exitCode: null };

  const handle = await spawnWorkspaceScript(settings.archive, {
    worktreePath,
    repoPath,
    onLine,
  });
  const exitCode = await handle.done;
  return { ran: true, exitCode };
}

export function listRunScripts(
  worktreePath: string,
  repoPath?: string | null,
): RunScript[] {
  const settings = loadWorkspaceSettings(worktreePath, repoPath);
  if (!settings?.runScripts.length) return [];
  return settings.runScripts.filter((s) => {
    if (!s.availableIn?.length) return true;
    return s.availableIn.includes('local');
  });
}

export function getDefaultRunScript(
  worktreePath: string,
  repoPath?: string | null,
): RunScript | null {
  const scripts = listRunScripts(worktreePath, repoPath);
  if (!scripts.length) return null;
  return (
    scripts.find((s) => s.default === true) ??
    scripts.find((s) => s.name === 'dev') ??
    scripts.find((s) => s.name !== 'all') ??
    scripts[0] ??
    null
  );
}

export function getRunScript(
  worktreePath: string,
  repoPath: string | null | undefined,
  name?: string | null,
): RunScript | null {
  const scripts = listRunScripts(worktreePath, repoPath);
  if (!scripts.length) return null;
  if (name) {
    return scripts.find((s) => s.name === name) ?? null;
  }
  return getDefaultRunScript(worktreePath, repoPath);
}

export function getRunMode(
  worktreePath: string,
  repoPath?: string | null,
): 'concurrent' | 'nonconcurrent' {
  return loadWorkspaceSettings(worktreePath, repoPath)?.runMode ?? 'concurrent';
}

export type PortReservation = {
  port: number;
  /** Stop holding the port so a child can bind it. Idempotent. */
  release: () => Promise<void>;
};

/**
 * Bind an ephemeral port and keep the socket open until `release()`.
 * Closing then rebinding races other worktrees / agents (TOCTOU) — especially
 * with Vite `strictPort: true`, which fails Start instead of falling back.
 */
export async function reservePort(): Promise<PortReservation> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    let released = false;
    const release = (): Promise<void> =>
      new Promise((res) => {
        if (released) {
          res();
          return;
        }
        released = true;
        server.close(() => res());
      });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        void release().then(() => reject(new Error('Failed to allocate port')));
        return;
      }
      resolve({ port: addr.port, release });
    });
    server.on('error', reject);
  });
}

/** @deprecated Prefer reservePort — releasing immediately reopens the race. */
export async function allocatePort(): Promise<number> {
  const held = await reservePort();
  await held.release();
  return held.port;
}

export async function tryReservePort(port: number): Promise<PortReservation | null> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return new Promise((resolve) => {
    const server = createServer();
    let released = false;
    const release = (): Promise<void> =>
      new Promise((res) => {
        if (released) {
          res();
          return;
        }
        released = true;
        server.close(() => res());
      });
    server.once('error', () => {
      try {
        server.close();
      } catch {
        // never listened
      }
      resolve(null);
    });
    server.listen(port, '127.0.0.1', () => {
      resolve({ port, release });
    });
  });
}

/** Reserve every port or none. */
export async function tryReservePorts(
  ports: number[],
): Promise<PortReservation[] | null> {
  const held: PortReservation[] = [];
  for (const port of ports) {
    const next = await tryReservePort(port);
    if (!next) {
      await Promise.all(held.map((h) => h.release()));
      return null;
    }
    held.push(next);
  }
  return held;
}

function normalizePreferredPorts(ports: number[] | undefined, size: number): number[] {
  if (!ports?.length) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const p of ports) {
    if (!Number.isInteger(p) || p <= 0 || p > 65535 || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= size) break;
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fillPortRange(
  held: PortReservation[],
  size: number,
): Promise<PortReservation[]> {
  if (held.length >= size) return held;
  const base = held[0]?.port;
  try {
    for (let i = held.length; i < size; i++) {
      const candidate = base != null ? base + i : null;
      const next =
        candidate != null ? await tryReservePort(candidate) : null;
      if (next) held.push(next);
      else held.push(await reservePort());
    }
    return held;
  } catch (err) {
    await Promise.all(held.map((h) => h.release()));
    throw err;
  }
}

async function reclaimPreferredPorts(
  ports: number[],
  worktreePath: string | undefined,
): Promise<PortReservation[] | null> {
  let held = await tryReservePorts(ports);
  if (held) return held;
  if (worktreePath) {
    killStaleWorktreeListeners(ports, worktreePath, 'SIGTERM');
  } else {
    killListenersOnPorts(ports);
  }
  for (let i = 0; i < RECLAIM_TRIES; i++) {
    await delay(RECLAIM_RETRY_DELAY_MS);
    held = await tryReservePorts(ports);
    if (held) return held;
    if (i === 2 && worktreePath) {
      killStaleWorktreeListeners(ports, worktreePath, 'SIGKILL');
    }
  }
  return null;
}

export type ReservePortRangeOpts = {
  /** Reuse this worktree's last assignment when still free (or reclaimable). */
  preferred?: number[];
  /** When preferred ports are busy, kill leftovers whose cwd is this worktree. */
  worktreePath?: string;
};

/**
 * Hold a block of ports (Conductor: CONDUCTOR_PORT … +9) until release.
 * Callers must `release()` immediately before spawning the child that binds them.
 * When `preferred` is set, reuse those ports — reclaim a leftover Dev instance
 * on them instead of allocating a new range.
 */
export async function reservePortRange(
  size = PORT_RANGE_SIZE,
  opts?: ReservePortRangeOpts,
): Promise<PortReservation[]> {
  const preferred = normalizePreferredPorts(opts?.preferred, size);
  if (preferred.length) {
    const reused = await reclaimPreferredPorts(preferred, opts?.worktreePath);
    if (reused) return fillPortRange(reused, size);
  }

  const held: PortReservation[] = [await reservePort()];
  return fillPortRange(held, size);
}

/** Allocate a contiguous block, releasing holds immediately (legacy / tests). */
export async function allocatePortRange(
  size = PORT_RANGE_SIZE,
): Promise<number[]> {
  const held = await reservePortRange(size);
  const ports = held.map((h) => h.port);
  await Promise.all(held.map((h) => h.release()));
  return ports;
}

export interface DevServerHandle {
  pid: number | undefined;
  port: number;
  ports: number[];
  scriptName: string;
  kill: () => void;
  done: Promise<number | null>;
}

export async function startDevServer(
  repoPath: string,
  worktreePath: string,
  onLine?: (line: string) => void,
  opts?: { scriptName?: string; defaultBranch?: string; preferredPorts?: number[] },
): Promise<DevServerHandle | null> {
  const script = getRunScript(worktreePath, repoPath, opts?.scriptName);
  if (!script) return null;

  // Reuse this worktree's last SIDEBOARD_PORT range so Stop / Start stays put.
  // Hold until spawn so another Start cannot steal the ports (Vite strictPort).
  const preferred =
    loadWorktreeRunPorts(worktreePath, script.name) ?? opts?.preferredPorts;
  const held = await reservePortRange(PORT_RANGE_SIZE, {
    preferred: preferred ?? undefined,
    worktreePath,
  });
  const ports = held.map((h) => h.port);
  saveWorktreeRunPorts(worktreePath, script.name, ports);
  try {
    const handle = await spawnWorkspaceScript(script.command, {
      worktreePath,
      repoPath,
      ports,
      heldPorts: held,
      defaultBranch: opts?.defaultBranch,
      onLine,
    });

    return {
      pid: handle.pid,
      port: ports[0]!,
      ports,
      scriptName: script.name,
      kill: handle.kill,
      done: handle.done,
    };
  } catch (err) {
    await Promise.all(held.map((h) => h.release()));
    throw err;
  }
}
