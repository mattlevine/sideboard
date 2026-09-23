/**
 * Resolve a user-installed `@cursor/sdk` (npm global, then Node resolution).
 * Sideboard does not pin the SDK in the app — Install / `npm i -g @cursor/sdk`
 * updates it without a new Sideboard build.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { npmGlobalNodeModules } from './path.js';

export const CURSOR_SDK_INSTALL_HINT =
  'Cursor SDK is not installed. Settings → Agents → Cursor → Install (`npm i -g @cursor/sdk`). Sideboard does not ship the SDK — update it anytime without a new Sideboard build.';

function thisModuleFile(): string {
  const cjsDir = typeof __dirname !== 'undefined' ? __dirname : '';
  if (cjsDir) return join(cjsDir, 'cursor-sdk-resolve.js');
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return join(process.cwd(), 'package.json');
  }
}

function packageRootLooksLikeSdk(dir: string): boolean {
  try {
    const raw = readFileSync(join(dir, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { name?: string };
    return pkg.name === '@cursor/sdk' && existsSync(dir);
  } catch {
    return false;
  }
}

function resolvedPackageRoot(fromFile: string): string | null {
  try {
    const req = createRequire(fromFile);
    const pkgJson = req.resolve('@cursor/sdk/package.json');
    const root = dirname(pkgJson);
    return packageRootLooksLikeSdk(root) ? root : null;
  } catch {
    return null;
  }
}

/** Directory of the installed `@cursor/sdk` package, or null. */
export function resolveCursorSdkRoot(opts?: { env?: NodeJS.ProcessEnv }): string | null {
  const env = opts?.env ?? process.env;
  const override = env.SIDEBOARD_CURSOR_SDK?.trim();
  // Explicit override wins or fails closed — do not silently use another copy.
  if (override) {
    return packageRootLooksLikeSdk(override) ? override : null;
  }

  const globalNm = npmGlobalNodeModules(env);
  if (globalNm) {
    const globalRoot = join(globalNm, '@cursor/sdk');
    if (packageRootLooksLikeSdk(globalRoot)) return globalRoot;
  }

  const cwdPkg = join(process.cwd(), 'package.json');
  return resolvedPackageRoot(thisModuleFile()) ?? resolvedPackageRoot(cwdPkg);
}

export function isCursorSdkInstalled(opts?: { env?: NodeJS.ProcessEnv }): boolean {
  return Boolean(resolveCursorSdkRoot(opts));
}

type CursorSdkModule = typeof import('@cursor/sdk');

function exportTarget(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return exportTarget(v.import) ?? exportTarget(v.default);
  }
  return null;
}

/**
 * ESM entry of the SDK package (`exports["."].import` → `.default` → `module`).
 * `createRequire().resolve` picks the `require` condition — a webpack CJS bundle
 * whose dynamic `import()` exposes only `default`, not the named exports.
 */
export function cursorSdkEsmEntry(root: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      exports?: unknown;
      module?: unknown;
    };
    const exp = pkg.exports;
    const dot =
      exp && typeof exp === 'object' && !Array.isArray(exp) && '.' in exp
        ? (exp as Record<string, unknown>)['.']
        : exp;
    const rel =
      exportTarget(dot) ?? (typeof pkg.module === 'string' ? pkg.module : null);
    if (!rel) return null;
    const entry = join(root, rel);
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

/** CJS bundles imported from ESM put the named exports under `default`. */
export function unwrapCursorSdkModule(mod: unknown): CursorSdkModule {
  const m = mod as Partial<CursorSdkModule> & { default?: Partial<CursorSdkModule> };
  if (m && !m.Agent && m.default?.Agent) return m.default as CursorSdkModule;
  return m as CursorSdkModule;
}

/** True when the loaded SDK has what cursor-runner constructs. */
export function cursorSdkHasExpectedExports(mod: unknown): boolean {
  const m = mod as Partial<CursorSdkModule> | null;
  return typeof m?.Agent === 'function' && typeof m?.JsonlLocalAgentStore === 'function';
}

export function cursorSdkMissingExportsMessage(root: string | null): string {
  return `Cursor SDK at ${root ?? '(unknown)'} is missing expected exports (Agent, JsonlLocalAgentStore) — reinstall with \`npm i -g @cursor/sdk\`.`;
}

/** Dynamic import of the user-installed SDK (ESM; not NODE_PATH). */
export async function importCursorSdk(
  opts?: { env?: NodeJS.ProcessEnv },
): Promise<CursorSdkModule | null> {
  const root = resolveCursorSdkRoot(opts);
  if (!root) return null;
  try {
    let entry = cursorSdkEsmEntry(root);
    if (!entry) {
      const req = createRequire(join(root, 'package.json'));
      entry = req.resolve('@cursor/sdk');
    }
    return unwrapCursorSdkModule(await import(pathToFileURL(entry).href));
  } catch {
    return null;
  }
}

export function cursorSdkPlatformRipgrepPackage(): string {
  return `@cursor/sdk-${process.platform}-${process.arch}`;
}

/** `node_modules` that contains `@scope/name` or `name`. */
function nodeModulesDirForPackageRoot(packageRoot: string): string {
  const parent = dirname(packageRoot);
  return basename(parent).startsWith('@') ? dirname(parent) : parent;
}

export function cursorSdkRipgrepCandidate(
  opts?: { env?: NodeJS.ProcessEnv },
): string | null {
  const root = resolveCursorSdkRoot(opts);
  if (!root) return null;
  const nm = nodeModulesDirForPackageRoot(root);
  const pkg = cursorSdkPlatformRipgrepPackage();
  const bin = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const sibling = join(nm, pkg, 'bin', bin);
  if (existsSync(sibling)) return sibling;
  const nested = join(root, 'node_modules', pkg, 'bin', bin);
  return existsSync(nested) ? nested : null;
}
