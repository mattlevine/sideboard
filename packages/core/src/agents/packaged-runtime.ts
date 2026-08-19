/**
 * Paths inside the packaged Mac app's extraResources tree.
 *
 * electron-builder cannot `asarUnpack` pnpm workspace links that realpath
 * outside `apps/desktop`. Cursor's runner + `@cursor/sdk` + `rg` are copied
 * to `Contents/Resources/cursor-runtime` instead so a real `node` can exec them.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

type ProcessWithResources = NodeJS.Process & { resourcesPath?: string };

export function electronResourcesPath(): string | null {
  const resources = (process as ProcessWithResources).resourcesPath;
  if (typeof resources !== 'string' || !resources) return null;
  return resources;
}

export function packagedCursorRuntimeDir(): string | null {
  const resources = electronResourcesPath();
  if (!resources) return null;
  const dir = join(resources, 'cursor-runtime');
  if (!existsSync(join(dir, 'core-dist', 'agents', 'cursor-runner.js'))) return null;
  return dir;
}

export function packagedCursorRunnerPath(): string | null {
  const dir = packagedCursorRuntimeDir();
  return dir ? join(dir, 'core-dist', 'agents', 'cursor-runner.js') : null;
}

export function packagedCursorRipgrepCandidate(
  platformPkg: string,
  binName: string,
): string | null {
  const dir = packagedCursorRuntimeDir();
  if (!dir) return null;
  return join(dir, 'node_modules', platformPkg, 'bin', binName);
}
