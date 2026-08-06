import { execa, type ExecaError } from 'execa';
import { ensureAgentPath } from '../agents/path.js';

export async function run(
  file: string,
  args: string[],
  opts?: { cwd?: string; reject?: boolean; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // GUI Electron often starts without Homebrew — ensure git/gh resolve.
  ensureAgentPath();
  try {
    const result = await execa(file, args, {
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env },
      reject: opts?.reject ?? true,
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
  opts?: { reject?: boolean },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return run('git', args, { cwd, reject: opts?.reject });
}

export async function gh(
  args: string[],
  cwd: string,
  opts?: { reject?: boolean },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return run('gh', args, { cwd, reject: opts?.reject });
}
