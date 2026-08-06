import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { createInterface } from 'node:readline';

/**
 * Cursor `.cursor/worktrees.json` setup — used when Sideboard/Conductor
 * settings have no setup script.
 *
 * Docs: https://cursor.com/docs/configuration/worktrees
 */
export interface CursorWorktreesConfig {
  'setup-worktree'?: string | string[];
  'setup-worktree-unix'?: string | string[];
  'setup-worktree-windows'?: string | string[];
}

function loadCursorWorktreesJson(rootPath: string): CursorWorktreesConfig | null {
  const path = join(rootPath, '.cursor', 'worktrees.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CursorWorktreesConfig;
  } catch {
    return null;
  }
}

function resolveSetupSpec(
  config: CursorWorktreesConfig,
): string | string[] | null {
  if (process.platform === 'win32') {
    return (
      config['setup-worktree-windows'] ??
      config['setup-worktree'] ??
      null
    );
  }
  return (
    config['setup-worktree-unix'] ??
    config['setup-worktree'] ??
    null
  );
}

/**
 * Run Cursor worktree setup if `.cursor/worktrees.json` exists.
 * Prefers worktree copy, then main repo. Sets ROOT_WORKTREE_PATH to the main checkout.
 */
export async function runCursorWorktreeSetup(
  repoPath: string,
  worktreePath: string,
  onLine?: (line: string) => void,
): Promise<{ ran: boolean; exitCode: number | null; source: string | null }> {
  const fromWorktree = loadCursorWorktreesJson(worktreePath);
  const fromRepo =
    worktreePath !== repoPath ? loadCursorWorktreesJson(repoPath) : null;
  const config = fromWorktree ?? fromRepo;
  if (!config) return { ran: false, exitCode: null, source: null };

  const spec = resolveSetupSpec(config);
  if (!spec) return { ran: false, exitCode: null, source: null };

  const sourceLabel = fromWorktree
    ? '.cursor/worktrees.json (worktree)'
    : '.cursor/worktrees.json (main repo)';

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ROOT_WORKTREE_PATH: repoPath,
  };
  // Windows PowerShell form used in Cursor docs
  if (process.platform === 'win32') {
    env.ROOT_WORKTREE_PATH = repoPath;
  }

  const commands = Array.isArray(spec)
    ? spec
    : [spec.endsWith('.sh') || spec.endsWith('.ps1')
        ? join(
            fromWorktree ? worktreePath : repoPath,
            '.cursor',
            spec,
          )
        : spec];

  let lastExit: number | null = 0;
  for (const command of commands) {
    const isScriptPath =
      typeof spec === 'string' &&
      (spec.endsWith('.sh') || spec.endsWith('.ps1'));
    const shell = process.platform === 'win32' ? 'powershell' : 'bash';
    const args =
      process.platform === 'win32'
        ? isScriptPath
          ? ['-File', command]
          : ['-Command', command]
        : isScriptPath
          ? [command]
          : ['-lc', command];

    onLine?.(`[cursor setup] ${command}`);
    const child = execa(shell, args, {
      cwd: worktreePath,
      reject: false,
      env,
    });
    if (child.stdout && onLine) {
      const rl = createInterface({ input: child.stdout });
      rl.on('line', onLine);
    }
    if (child.stderr && onLine) {
      const rl = createInterface({ input: child.stderr });
      rl.on('line', onLine);
    }
    const result = await child;
    lastExit = result.exitCode ?? null;
    if (lastExit !== 0 && lastExit !== null) break;
  }

  return { ran: true, exitCode: lastExit, source: sourceLabel };
}

export function hasCursorWorktreeSetup(
  worktreePath: string,
  repoPath?: string | null,
): boolean {
  if (loadCursorWorktreesJson(worktreePath)) return true;
  if (repoPath && repoPath !== worktreePath && loadCursorWorktreesJson(repoPath)) {
    return true;
  }
  return false;
}
