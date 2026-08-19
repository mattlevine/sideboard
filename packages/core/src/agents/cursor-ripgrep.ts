/**
 * Cursor's local agent indexes the worktree with ripgrep
 * (`findFilesWithRipgrep`). It looks for an absolute `CURSOR_RIPGREP_PATH`,
 * then walks from `process.argv[1]` for `node_modules/@cursor/sdk-<plat>/bin/rg`.
 *
 * Inside Sideboard.app that walk lands on `app.asar/.../rg`, which macOS cannot
 * exec. Point the env var at extraResources `cursor-runtime/.../rg` (or an
 * unpacked sibling) before the SDK starts.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, parse, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAsarPath, nodeReadableScriptPath } from './node-launch.js';
import { packagedCursorRipgrepCandidate } from './packaged-runtime.js';

const RIPGREP_ENV = 'CURSOR_RIPGREP_PATH';

function rgBinaryName(): string {
  return process.platform === 'win32' ? 'rg.exe' : 'rg';
}

function platformRipgrepPackage(): string {
  return `@cursor/sdk-${process.platform}-${process.arch}`;
}

/** Prefer an unpacked/real path; never return a file that still lives in asar. */
export function usableRipgrepPath(candidate: string | null | undefined): string | null {
  const raw = candidate?.trim();
  if (!raw || !isAbsolute(raw)) return null;
  const readable = nodeReadableScriptPath(raw);
  if (!existsSync(readable) || isAsarPath(readable)) return null;
  return readable;
}

function walkForBundledRipgrep(startFile: string): string | null {
  if (!startFile) return null;
  const pkg = platformRipgrepPackage();
  const name = rgBinaryName();
  let dir = dirname(resolvePath(startFile));
  const root = parse(dir).root;
  while (dir !== root) {
    const hit = usableRipgrepPath(join(dir, 'node_modules', pkg, 'bin', name));
    if (hit) return hit;
    const next = dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  return null;
}

function requireResolveBundledRipgrep(fromFile: string): string | null {
  try {
    const req = createRequire(fromFile);
    const pkgJson = req.resolve(`${platformRipgrepPackage()}/package.json`);
    return usableRipgrepPath(join(dirname(pkgJson), 'bin', rgBinaryName()));
  } catch {
    return null;
  }
}

export function resolveCursorRipgrepPath(opts?: {
  env?: NodeJS.ProcessEnv;
  startFile?: string;
}): string | null {
  const env = opts?.env ?? process.env;
  const fromEnv = usableRipgrepPath(env[RIPGREP_ENV]);
  if (fromEnv) return fromEnv;

  const fromPackaged = usableRipgrepPath(
    packagedCursorRipgrepCandidate(platformRipgrepPackage(), rgBinaryName()),
  );
  if (fromPackaged) return fromPackaged;

  const start =
    opts?.startFile?.trim() ||
    process.argv[1] ||
    fileURLToPath(import.meta.url);

  return walkForBundledRipgrep(start) ?? requireResolveBundledRipgrep(start);
}

/** Env to merge into the Cursor runner spawn. Empty when rg cannot be exec'd. */
export function cursorRipgrepEnv(opts?: {
  env?: NodeJS.ProcessEnv;
  startFile?: string;
}): Record<string, string> {
  const path = resolveCursorRipgrepPath(opts);
  return path ? { [RIPGREP_ENV]: path } : {};
}

/** Set `CURSOR_RIPGREP_PATH` on this process before `@cursor/sdk` loads ignore maps. */
export function ensureCursorRipgrepPath(opts?: {
  env?: NodeJS.ProcessEnv;
  startFile?: string;
}): string | null {
  const target = opts?.env ?? process.env;
  const path = resolveCursorRipgrepPath({ env: target, startFile: opts?.startFile });
  if (path) target[RIPGREP_ENV] = path;
  return path;
}
