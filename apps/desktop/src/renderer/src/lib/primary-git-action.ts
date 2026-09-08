export type PrimaryGitAction =
  | 'live'
  | 'closed'
  | 'cowboy-commit-push'
  | 'cowboy-push'
  | 'create-pr'
  | 'queued'
  | 'resolve'
  | 'update'
  | 'commit-push'
  | 'ready-for-review'
  | 'checks-failing'
  | 'checks-pending'
  | 'needs-approval'
  | 'changes-requested'
  | 'merge';

function reviewDecisionOf(value: string | null | undefined): string {
  return (value ?? '').toUpperCase();
}

export function primaryGitAction(opts: {
  prMerged: boolean;
  prClosed: boolean;
  cowboy: boolean;
  hasPr: boolean;
  prDraft: boolean;
  inMergeQueue: boolean;
  mergeConflicts: boolean;
  branchBehind: boolean;
  hasLocalChanges: boolean;
  /** Working tree clean and origin/<branch> has every local commit. */
  originInSync: boolean;
  /** GitHub `reviewDecision` (`REVIEW_REQUIRED` / `CHANGES_REQUESTED` / `APPROVED`). */
  reviewDecision?: string | null;
  /** CI failed (`gh pr checks`). */
  checksFailed?: boolean;
  /** CI still running; no failures yet. */
  checksPending?: boolean;
}): PrimaryGitAction {
  if (opts.prMerged) return 'live';
  if (opts.prClosed) return 'closed';
  if (opts.cowboy) return opts.hasLocalChanges ? 'cowboy-commit-push' : 'cowboy-push';
  if (!opts.hasPr) return 'create-pr';
  if (opts.inMergeQueue) return 'queued';
  // Conflicts block merge (failure). Behind-base does not — it is an update, not CI red.
  if (opts.mergeConflicts) return 'resolve';
  if (opts.branchBehind) return 'update';
  if (opts.hasLocalChanges) return 'commit-push';
  if (opts.prDraft) return opts.originInSync ? 'ready-for-review' : 'commit-push';
  if (opts.checksFailed) return 'checks-failing';
  const review = reviewDecisionOf(opts.reviewDecision);
  if (review === 'CHANGES_REQUESTED') return 'changes-requested';
  // GitHub only sets REVIEW_REQUIRED when branch protection requires reviews.
  // Waiting PRs often have a null decision — still not approved, so don't say Merge.
  if (review !== 'APPROVED') return 'needs-approval';
  if (opts.checksPending) return 'checks-pending';
  return 'merge';
}

export function primaryGitLabel(action: PrimaryGitAction): string {
  switch (action) {
    case 'live':
      return 'Live';
    case 'closed':
      return 'Closed';
    case 'cowboy-commit-push':
    case 'commit-push':
      return 'Commit & push';
    case 'cowboy-push':
      return 'Push';
    case 'create-pr':
      return 'Create PR';
    case 'queued':
      return 'Queued';
    case 'resolve':
      return 'Resolve';
    case 'update':
      return 'Update';
    case 'ready-for-review':
      return 'Ready for review';
    case 'checks-failing':
      return 'Checks failing';
    case 'checks-pending':
      return 'Checks pending';
    case 'needs-approval':
      return 'Needs approval';
    case 'changes-requested':
      return 'Changes requested';
    case 'merge':
      return 'Merge';
  }
}

export function primaryGitIcon(action: PrimaryGitAction): string {
  switch (action) {
    case 'live':
      return '●';
    case 'closed':
      return '✕';
    case 'cowboy-commit-push':
    case 'cowboy-push':
    case 'commit-push':
    case 'update':
      return '↑';
    case 'create-pr':
      return '⎇';
    case 'queued':
      return '☰';
    case 'resolve':
      return '⚡';
    case 'ready-for-review':
      return '✓';
    case 'checks-failing':
      return '✕';
    case 'checks-pending':
      return '●';
    case 'needs-approval':
      return '○';
    case 'changes-requested':
      return '!';
    case 'merge':
      return '⤵';
  }
}
