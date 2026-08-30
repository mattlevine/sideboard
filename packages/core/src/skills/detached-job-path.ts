import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packagedMcpDir } from '../agents/packaged-runtime.js';

/** Packaged extraResources copy (`Contents/Resources/sideboard-mcp/scripts/detached-job.js`). */
export function packagedDetachedJobPath(): string | null {
  const dir = packagedMcpDir();
  if (!dir) return null;
  const script = join(dir, 'scripts', 'detached-job.js');
  return existsSync(script) ? script : null;
}

/**
 * Absolute path to the detach helper agents should exec.
 * Packaged app first, then walk up from this module to the repo `scripts/` copy.
 */
export function resolveDetachedJobScript(): string | null {
  const packaged = packagedDetachedJobPath();
  if (packaged) return packaged;

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'scripts', 'detached-job.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Shell invocation agents can copy (`node "/abs/path/detached-job.js"`). */
export function formatDetachedJobInvoke(scriptPath?: string | null): string {
  const resolved = scriptPath === undefined ? resolveDetachedJobScript() : scriptPath;
  if (resolved) return `node ${JSON.stringify(resolved)}`;
  return 'node scripts/detached-job.js';
}
