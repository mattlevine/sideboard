import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, join } from 'node:path';
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
import { findConventionSetup } from './convention-setup.js';
import { runCursorWorktreeSetup } from './cursor-worktrees.js';
import { mergeAgentGitAuthEnv, resolveAgentGitAuthEnv } from '../git/git-auth-mode.js';
import { ensureReviewSkillFile, REVIEW_SKILL_PATH } from '../review/request-review.js';
import { ensureWorktreeSideboardIgnored } from '../git/worktree-exclude.js';

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

const PORT_RANGE_SIZE = 10;

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
  for (const port of ports) {
    if (!Number.isFinite(port) || port <= 0) continue;
    if (process.platform === 'win32') {
      void execa(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
        ],
        { reject: false },
      );
    } else {
      void execa(
        'zsh',
        ['-lc', `pids=$(lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null); [ -n "$pids" ] && kill -TERM $pids 2>/dev/null; true`],
        { reject: false },
      );
    }
  }
}

async function spawnWorkspaceScript(
  command: string,
  opts: {
    worktreePath: string;
    repoPath: string;
    ports?: number[];
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
    source: workspaceSettingsSourceLabel(worktreePath, repoPath),
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
 * Setup for a new worktree. Seeds `.claude/skills/review/SKILL.md` when missing,
 * then `[scripts] setup`, Cursor `.cursor/worktrees.json`, then `script/setup`.
 */
export async function runWorkspaceSetup(
  repoPath: string,
  worktreePath: string,
  onLine?: (line: string) => void,
  opts?: { signal?: AbortSignal; defaultBranch?: string },
): Promise<SetupRunResult> {
  await ensureWorktreeSideboardIgnored(worktreePath);
  const reviewSkill = ensureReviewSkillFile(worktreePath);
  if (reviewSkill.wrote) {
    onLine?.(
      `[setup] wrote ${REVIEW_SKILL_PATH} — commit it so later worktrees inherit Review guidelines`,
    );
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

export async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to allocate port'));
        return;
      }
      const port = addr.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

/** Allocate a contiguous block of ports (Conductor: CONDUCTOR_PORT … +9). */
export async function allocatePortRange(
  size = PORT_RANGE_SIZE,
): Promise<number[]> {
  const base = await allocatePort();
  const ports: number[] = [base];
  for (let i = 1; i < size; i++) {
    const candidate = base + i;
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.listen(candidate, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
    });
    if (free) {
      ports.push(candidate);
    } else {
      ports.push(await allocatePort());
    }
  }
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
  opts?: { scriptName?: string; defaultBranch?: string },
): Promise<DevServerHandle | null> {
  const script = getRunScript(worktreePath, repoPath, opts?.scriptName);
  if (!script) return null;

  const ports = await allocatePortRange(PORT_RANGE_SIZE);
  const handle = await spawnWorkspaceScript(script.command, {
    worktreePath,
    repoPath,
    ports,
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
}
