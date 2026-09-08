import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packagedMcpDir } from '../agents/packaged-runtime.js';

/** `.cjs` first — packaged MCP writes `"type": "module"` next to this file. */
const DETACHED_JOB_FILENAMES = ['detached-job.cjs', 'detached-job.js'] as const;

function detachedJobScriptIn(dir: string): string | null {
  for (const name of DETACHED_JOB_FILENAMES) {
    const script = join(dir, 'scripts', name);
    if (existsSync(script)) return script;
  }
  return null;
}

/** Packaged extraResources copy (`Contents/Resources/sideboard-mcp/scripts/detached-job.cjs`). */
export function packagedDetachedJobPath(): string | null {
  const dir = packagedMcpDir();
  if (!dir) return null;
  return detachedJobScriptIn(dir);
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
    const candidate = detachedJobScriptIn(dir);
    if (candidate) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Shell invocation agents can copy (`node "/abs/path/detached-job.cjs"`). */
export function formatDetachedJobInvoke(scriptPath?: string | null): string {
  const resolved = scriptPath === undefined ? resolveDetachedJobScript() : scriptPath;
  if (resolved) return `node ${JSON.stringify(resolved)}`;
  return 'node scripts/detached-job.cjs';
}
