import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const EXTRA_BIN_DIRS = [
  '.local/bin',
  '.cargo/bin',
  '.nvm/current/bin',
  '.asdf/shims',
  '.volta/bin',
  '.npm-global/bin',
  // fnm default alias (common when shell init is skipped)
  '.local/share/fnm/aliases/default/bin',
  // pnpm / npm global bins (where `@brightsy/cli` typically lands)
  'Library/pnpm',
  '.pnpm',
] as const;

function prependPathDir(env: NodeJS.ProcessEnv, dir: string): void {
  if (!dir || !existsSync(dir)) return;
  const current = env.PATH ?? '';
  const parts = current.split(delimiter).filter(Boolean);
  if (parts.includes(dir)) {
    env.PATH = current;
    return;
  }
  env.PATH = [dir, ...parts].join(delimiter);
}

/**
 * Electron / GUI apps often inherit a minimal PATH that omits Homebrew and
 * user bin dirs where `claude` / `codex` / `opencode` / `brightsy` live. Call
 * once at process start (and before agent spawns) so adapters can resolve CLIs.
 */
export function ensureAgentPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  const current = env.PATH ?? '';
  const parts = current.split(delimiter).filter(Boolean);
  const seen = new Set(parts);

  const extras: string[] = [
    ...EXTRA_BIN_DIRS.map((rel) => join(home, rel)),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];

  for (const dir of extras.reverse()) {
    if (!dir || seen.has(dir) || !existsSync(dir)) continue;
    parts.unshift(dir);
    seen.add(dir);
  }

  const next = parts.join(delimiter);
  env.PATH = next;
  return next;
}

/**
 * Prepend the active `npm prefix -g`/bin dir (where `npm i -g @openai/codex`
 * lands). Electron often finds this via ensureAgentPath heuristics, but a
 * fresh Terminal window may not — causing "codex: command not found" on login.
 */
export function enrichPathWithNpmGlobalBin(
  env: NodeJS.ProcessEnv = process.env,
): string {
  ensureAgentPath(env);
  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 8_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split(/\r?\n/)
      .find(Boolean);
    if (prefix) {
      const binDir = process.platform === 'win32' ? prefix : join(prefix, 'bin');
      prependPathDir(env, binDir);
    }
  } catch {
    // npm missing — leave PATH as ensureAgentPath left it
  }
  return env.PATH ?? '';
}

/** Escape a value for use inside a POSIX single-quoted string. */
export function posixShellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Rewrite `codex login` → `/abs/path/codex login` when `which` can see the bin
 * on the enriched Electron PATH.
 */
export function resolveCommandBinarySync(
  command: string,
  whichPath: string | null | undefined,
): string {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  const match = /^(\S+)(\s[\s\S]*)?$/.exec(trimmed);
  if (!match) return trimmed;
  const bin = match[1]!;
  const rest = match[2] ?? '';
  if (bin.includes('/') || bin.includes('\\')) return trimmed;
  const abs = whichPath?.trim().split(/\r?\n/).find(Boolean);
  if (!abs) return trimmed;
  return `${abs}${rest}`;
}

/** `export PATH='…'; <command>` so Terminal inherits Electron’s enriched PATH. */
export function withExportedPath(command: string, pathValue: string): string {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  if (/^(export\s+PATH=|PATH=)/.test(trimmed)) return trimmed;
  return `export PATH=${posixShellSingleQuote(pathValue)}; ${trimmed}`;
}
