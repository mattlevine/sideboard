import type { PrCheckRun } from '../types/thread.js';

/** Fields from `gh pr view` that affect whether GitHub will accept a merge. */
export interface PrMergeGate {
  mergeable: string | null;
  mergeStateStatus: string | null;
  reviewDecision: string | null;
  baseRefName: string | null;
  url: string | null;
}

export interface BuildMergeGateOptions {
  /**
   * When true (default), skip a generic "Merge blocked" row — that status usually
   * duplicates failing required CI / missing reviews already shown elsewhere.
   * Set false only when CI is clean and no review row will be emitted.
   */
  suppressGenericBlocked?: boolean;
}

/**
 * Turn GitHub mergeability / review decision into synthetic check rows.
 * CI (`gh pr checks`) never reports merge conflicts — those live on the PR itself.
 */
export function buildMergeGateChecks(
  gate: PrMergeGate,
  opts: BuildMergeGateOptions = {},
): PrCheckRun[] {
  const rows: PrCheckRun[] = [];
  const base = gate.baseRefName?.trim() || 'the base branch';
  const link = gate.url?.trim() || null;
  const mergeable = (gate.mergeable ?? '').toUpperCase();
  const mergeState = (gate.mergeStateStatus ?? '').toUpperCase();
  const review = (gate.reviewDecision ?? '').toUpperCase();
  const suppressBlocked = opts.suppressGenericBlocked !== false;

  const conflicting =
    mergeable === 'CONFLICTING' || mergeState === 'DIRTY';
  if (conflicting) {
    rows.push({
      name: 'Merge conflicts',
      state: mergeable === 'CONFLICTING' ? 'CONFLICTING' : mergeState || 'DIRTY',
      bucket: 'fail',
      startedAt: null,
      completedAt: null,
      link,
      description: `This branch has conflicts that must be resolved before it can merge into ${base}.`,
      workflow: 'mergeability',
      kind: 'mergeability',
    });
  } else if (mergeState === 'BEHIND') {
    rows.push({
      name: 'Branch behind',
      state: 'BEHIND',
      bucket: 'fail',
      startedAt: null,
      completedAt: null,
      link,
      description: `Head is behind ${base}. Update this branch (merge or rebase) before merging.`,
      workflow: 'mergeability',
      kind: 'mergeability',
    });
  } else if (mergeState === 'BLOCKED' && !suppressBlocked) {
    rows.push({
      name: 'Merge blocked',
      state: 'BLOCKED',
      bucket: 'fail',
      startedAt: null,
      completedAt: null,
      link,
      description:
        'GitHub reports this PR as blocked (branch protection — required reviews and/or status checks).',
      workflow: 'mergeability',
      kind: 'mergeability',
    });
  } else if (mergeable === 'UNKNOWN' || mergeState === 'UNKNOWN') {
    rows.push({
      name: 'Mergeability',
      state: 'UNKNOWN',
      bucket: 'pending',
      startedAt: null,
      completedAt: null,
      link,
      description: 'GitHub is still computing whether this branch can merge.',
      workflow: 'mergeability',
      kind: 'mergeability',
    });
  }

  if (review === 'CHANGES_REQUESTED') {
    rows.push({
      name: 'Code review',
      state: 'CHANGES_REQUESTED',
      bucket: 'fail',
      startedAt: null,
      completedAt: null,
      link,
      description: 'A reviewer requested changes. Address their feedback before merging.',
      workflow: 'review',
      kind: 'review',
    });
  } else if (review === 'REVIEW_REQUIRED') {
    rows.push({
      name: 'Code review',
      state: 'REVIEW_REQUIRED',
      bucket: 'pending',
      startedAt: null,
      completedAt: null,
      link,
      description: 'A required approving review is still outstanding.',
      workflow: 'review',
      kind: 'review',
    });
  }

  return rows;
}
