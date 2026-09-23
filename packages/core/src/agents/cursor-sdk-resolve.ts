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

/** Dynamic import of the user-installed SDK (ESM; not NODE_PATH). */
export async function importCursorSdk(
  opts?: { env?: NodeJS.ProcessEnv },
): Promise<typeof import('@cursor/sdk') | null> {
  const root = resolveCursorSdkRoot(opts);
  if (!root) return null;
  try {
    const req = createRequire(join(root, 'package.json'));
    const entry = req.resolve('@cursor/sdk');
    return (await import(pathToFileURL(entry).href)) as typeof import('@cursor/sdk');
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
