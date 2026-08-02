import type { LandPreview, LandResult, Thread } from '../types/thread.js';
import {
  commitAll,
  createOrUpdatePr,
  isDirty,
  pushBranch,
  resolveDefaultBranch,
} from '../git/worktree.js';
import { getDiff } from '../diff/diff.js';
import { suggestPrMetadata } from './pr-metadata.js';

export async function previewLand(thread: Thread): Promise<LandPreview> {
  if (thread.sourceIsFork) {
    return {
      branch: thread.branchName,
      target: '(unknown)',
      diffStat: '',
      dirty: await isDirty(thread.worktreePath),
      blocked: true,
      blockReason: 'Cross-repository (fork) PR sources cannot be landed in v1',
      isFork: true,
    };
  }

  const target = await resolveDefaultBranch(thread.repoPath);
  if (thread.branchName === target || thread.branchName === 'main' || thread.branchName === 'master') {
    // Hard-block if the *thread branch* is the default — should never happen
    // with our create path, but guard anyway.
  }

  // Also block if somehow checked out default
  const { stdout: head } = await import('../git/run.js').then(({ git }) =>
    git(['rev-parse', '--abbrev-ref', 'HEAD'], thread.worktreePath),
  );
  const current = head.trim();
  if (current === target) {
    return {
      branch: current,
      target,
      diffStat: '',
      dirty: await isDirty(thread.worktreePath),
      blocked: true,
      blockReason: `Hard-blocked: branch resolves to default branch "${target}"`,
      isFork: false,
    };
  }

  const diff = await getDiff(thread.worktreePath, thread.repoPath, { base: target });
  return {
    branch: thread.branchName,
    target,
    diffStat: diff.stat,
    dirty: diff.dirty,
    blocked: false,
    isFork: false,
  };
}

export async function confirmLand(
  thread: Thread,
  opts?: { draft?: boolean; web?: boolean },
): Promise<LandResult> {
  const preview = await previewLand(thread);
  if (preview.blocked) {
    throw new Error(preview.blockReason ?? 'Land blocked');
  }

  const meta = await suggestPrMetadata(thread.worktreePath, {
    base: preview.target,
    fallbackTitle: thread.title,
    sourceLabel: `${thread.sourceType}:${thread.sourceRef}`,
  });

  let committed = false;
  if (preview.dirty) {
    committed = await commitAll(thread.worktreePath, meta.commitMessage);
  }

  // Prefer live HEAD in case the agent renamed the placeholder branch.
  const { git } = await import('../git/run.js');
  const { stdout: headOut } = await git(
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    thread.worktreePath,
    { reject: false },
  );
  const head = headOut.trim();
  const branch =
    head && head !== 'HEAD' ? head : thread.branchName;

  await pushBranch(thread.worktreePath, branch);
  const prUrl = await createOrUpdatePr(thread.worktreePath, {
    title: meta.title,
    body: meta.body,
    base: preview.target,
    head: branch,
    draft: opts?.draft,
    web: opts?.web,
  });

  return { prUrl, pushed: true, committed };
}
