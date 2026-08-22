import type { LandPreview, LandResult, Thread } from '../types/thread.js';
import {
  commitAll,
  createOrUpdatePr,
  currentBranch,
  isDirty,
  pushBranch,
  resolveDefaultBranch,
} from '../git/worktree.js';
import { getDiff } from '../diff/diff.js';
import { suggestPrMetadata } from './pr-metadata.js';
import { formatGhLandError } from '../git/gh-errors.js';
import { isCowboyThread } from '../threads/cowboy.js';

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

  if (isCowboyThread(thread)) {
    const current = await currentBranch(thread.worktreePath);
    const dirty = await isDirty(thread.worktreePath);
    const diff = await getDiff(thread.worktreePath, thread.repoPath, { base: current });
    return {
      branch: current,
      target: current,
      diffStat: diff.stat,
      dirty,
      blocked: false,
      isFork: false,
      cowboy: true,
    };
  }

  const target = await resolveDefaultBranch(thread.repoPath);

  // Also block if somehow checked out default
  const current = await currentBranch(thread.worktreePath);
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

  if (preview.cowboy) {
    const meta = await suggestPrMetadata(thread.worktreePath, {
      base: preview.branch,
      fallbackTitle: thread.title,
      sourceLabel: `${thread.sourceType}:${thread.sourceRef}`,
    });
    let committed = false;
    if (preview.dirty) {
      committed = await commitAll(thread.worktreePath, meta.commitMessage);
    }
    await pushBranch(thread.worktreePath, preview.branch);
    return { prUrl: null, pushed: true, committed };
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
  try {
    const prUrl = await createOrUpdatePr(thread.worktreePath, {
      title: meta.title,
      body: meta.body,
      base: preview.target,
      head: branch,
      draft: opts?.draft,
      web: opts?.web,
    });
    return { prUrl, pushed: true, committed };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // createOrUpdatePr already returns a short notice for rate limits; preserve it.
    if (raw.startsWith('GitHub API rate limit exceeded.')) throw err;
    if (/Command failed with exit code|API rate limit/i.test(raw)) {
      throw new Error(formatGhLandError(raw));
    }
    throw err;
  }
}
