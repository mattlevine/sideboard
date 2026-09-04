import { execa, type ExecaError } from 'execa';
import { ensureAgentPath } from '../agents/path.js';
import { githubAgentAuthReady, githubGhConfigEnv } from './github-agent-auth.js';
import { clearStaleIndexLocks, isIndexLockError } from './stale-lock.js';

export async function run(
  file: string,
  args: string[],
  opts?: {
    cwd?: string;
    reject?: boolean;
    env?: Record<string, string>;
    /** Kill the child after this many ms (execa `timeout`). */
    timeoutMs?: number;
  },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // GUI Electron often starts without Homebrew — ensure git/gh resolve.
  ensureAgentPath();
  try {
    const result = await execa(file, args, {
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env },
      reject: opts?.reject ?? true,
      ...(opts?.timeoutMs != null ? { timeout: opts.timeoutMs } : {}),
    });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0,
    };
  } catch (err) {
    const e = err as ExecaError;
    if (opts?.reject === false) {
      return {
        stdout: String(e.stdout ?? ''),
        stderr: String(e.stderr ?? ''),
        exitCode: e.exitCode ?? 1,
      };
    }
    throw err;
  }
}

/** Resolve gitdir + git-common-dir so a stale `index.lock` can be found and removed. */
export async function resolveGitDirsForLockRecovery(
  cwd: string,
  env: Record<string, string> = {},
): Promise<string[]> {
  const dirs = new Set<string>();
  const [gitDir, commonDir] = await Promise.all([
    run('git', ['rev-parse', '--absolute-git-dir'], { cwd, reject: false, env, timeoutMs: 5_000 }),
    run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd,
      reject: false,
      env,
      timeoutMs: 5_000,
    }),
  ]);
  if (gitDir.exitCode === 0 && gitDir.stdout.trim()) dirs.add(gitDir.stdout.trim());
  if (commonDir.exitCode === 0 && commonDir.stdout.trim()) dirs.add(commonDir.stdout.trim());
  return [...dirs];
}

export async function git(
  args: string[],
  cwd: string,
  opts?: {
    reject?: boolean;
    env?: Record<string, string>;
    /** Passed as `git -c key=value` (e.g. authenticated HTTPS via http.extraHeader). */
    config?: Record<string, string>;
    /** Kill after this many ms — critical for MCP so a stuck fetch cannot pin the stdio server. */
    timeoutMs?: number;
  },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const prefix: string[] = [];
  if (opts?.config) {
    for (const [key, value] of Object.entries(opts.config)) {
      if (!key) continue;
      prefix.push('-c', `${key}=${value}`);
    }
  }
  const gitArgs = ['--no-pager', ...prefix, ...args];
  const env = {
    // Never block forever on a credential/SSH prompt inside MCP / Electron.
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: process.env.GIT_ASKPASS || 'echo',
    SSH_ASKPASS: process.env.SSH_ASKPASS || 'echo',
    GIT_SSH_COMMAND:
      process.env.GIT_SSH_COMMAND ||
      'ssh -o BatchMode=yes -o ConnectTimeout=15',
    GCM_INTERACTIVE: 'never',
    GH_PROMPT_DISABLED: '1',
    ...opts?.env,
  };

  let result = await run('git', gitArgs, { cwd, reject: false, timeoutMs: opts?.timeoutMs, env });

  // A crashed/OOM-killed git child (agent commit, Sideboard push/land) can leave
  // index.lock behind, which blocks every further git command — Sideboard's own
  // actions and the user's own terminal git alike. If the lock is old enough to
  // be abandoned rather than in active use, clear it and retry once.
  if (result.exitCode !== 0 && isIndexLockError(result.stderr)) {
    const gitDirs = await resolveGitDirsForLockRecovery(cwd, env);
    const cleared = clearStaleIndexLocks(gitDirs);
    if (cleared.length > 0) {
      result = await run('git', gitArgs, { cwd, reject: false, timeoutMs: opts?.timeoutMs, env });
    }
  }

  if ((opts?.reject ?? true) && result.exitCode !== 0) {
    throw new Error(
      `Command failed with exit code ${result.exitCode}: git ${gitArgs.join(' ')}\n${result.stderr}`,
    );
  }
  return result;
}

export async function gh(
  args: string[],
  cwd: string,
  opts?: { reject?: boolean; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return run('gh', args, {
    cwd,
    reject: opts?.reject,
    timeoutMs: opts?.timeoutMs,
    env: {
      GH_PROMPT_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0',
      // Isolated hosts.yml uses git_protocol: https so `gh pr create` does not
      // shell out over SSH when Settings → Git is SSH (ask_git in Electron).
      ...(githubAgentAuthReady() ? githubGhConfigEnv() : {}),
    },
  });
}

/** GitHub CLI token for non-interactive HTTPS git (GUI apps often lack SSH agent). */
export async function resolveGhAuthToken(cwd: string): Promise<string | null> {
  const result = await gh(['auth', 'token'], cwd, { reject: false, timeoutMs: 8_000 });
  if (result.exitCode !== 0) return null;
  const token = result.stdout.trim();
  return token || null;
}
