import { execa, type ExecaError } from 'execa';
import { ensureAgentPath } from '../agents/path.js';

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
  return run('git', ['--no-pager', ...prefix, ...args], {
    cwd,
    reject: opts?.reject,
    timeoutMs: opts?.timeoutMs,
    // Never block forever on a credential/SSH prompt inside MCP / Electron.
    env: {
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: process.env.GIT_ASKPASS || 'echo',
      GIT_SSH_COMMAND:
        process.env.GIT_SSH_COMMAND ||
        'ssh -o BatchMode=yes -o ConnectTimeout=15',
      ...opts?.env,
    },
  });
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
  });
}

/** GitHub CLI token for non-interactive HTTPS git (GUI apps often lack SSH agent). */
export async function resolveGhAuthToken(cwd: string): Promise<string | null> {
  const result = await gh(['auth', 'token'], cwd, { reject: false });
  if (result.exitCode !== 0) return null;
  const token = result.stdout.trim();
  return token || null;
}
