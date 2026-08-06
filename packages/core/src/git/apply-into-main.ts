import { execa } from 'execa';
import type { Thread } from '../types/thread.js';
import { resolveDefaultBranch } from './worktree.js';

export interface ApplyIntoMainResult {
  applied: boolean;
  method: 'merge' | 'cherry-pick';
  targetBranch: string;
  message: string;
}

/**
 * Cursor `/apply-worktree` analog: bring the thread branch into the main
 * checkout without landing a PR. Human-gated; leaves the thread intact.
 */
export async function applyThreadIntoMain(
  thread: Pick<Thread, 'repoPath' | 'worktreePath' | 'branchName'>,
  opts?: { method?: 'merge' | 'cherry-pick'; targetBranch?: string },
): Promise<ApplyIntoMainResult> {
  const method = opts?.method ?? 'merge';
  const target =
    opts?.targetBranch?.trim() || (await resolveDefaultBranch(thread.repoPath));

  const status = await execa('git', ['status', '--porcelain'], {
    cwd: thread.repoPath,
    reject: false,
  });
  if (status.stdout.trim()) {
    throw new Error(
      `Main checkout is dirty — commit or stash before apply-into-main (${thread.repoPath})`,
    );
  }

  const checkout = await execa('git', ['checkout', target], {
    cwd: thread.repoPath,
    reject: false,
  });
  if (checkout.exitCode !== 0) {
    throw new Error(
      `Failed to checkout ${target}: ${checkout.stderr.trim() || checkout.stdout.trim()}`,
    );
  }

  if (method === 'cherry-pick') {
    const log = await execa(
      'git',
      ['log', '--reverse', '--format=%H', `${target}..${thread.branchName}`],
      { cwd: thread.repoPath, reject: false },
    );
    const shas = log.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!shas.length) {
      return {
        applied: false,
        method,
        targetBranch: target,
        message: `No commits on ${thread.branchName} not already in ${target}`,
      };
    }
    for (const sha of shas) {
      const cp = await execa('git', ['cherry-pick', sha], {
        cwd: thread.repoPath,
        reject: false,
      });
      if (cp.exitCode !== 0) {
        await execa('git', ['cherry-pick', '--abort'], {
          cwd: thread.repoPath,
          reject: false,
        });
        throw new Error(
          `Cherry-pick ${sha.slice(0, 8)} failed: ${cp.stderr.trim() || cp.stdout.trim()}`,
        );
      }
    }
    return {
      applied: true,
      method,
      targetBranch: target,
      message: `Cherry-picked ${shas.length} commit(s) from ${thread.branchName} into ${target}`,
    };
  }

  const merge = await execa(
    'git',
    ['merge', '--no-ff', '-m', `Apply Sideboard thread ${thread.branchName}`, thread.branchName],
    { cwd: thread.repoPath, reject: false },
  );
  if (merge.exitCode !== 0) {
    await execa('git', ['merge', '--abort'], {
      cwd: thread.repoPath,
      reject: false,
    });
    throw new Error(
      `Merge failed: ${merge.stderr.trim() || merge.stdout.trim()}`,
    );
  }
  return {
    applied: true,
    method: 'merge',
    targetBranch: target,
    message: `Merged ${thread.branchName} into ${target} at ${thread.repoPath}`,
  };
}
