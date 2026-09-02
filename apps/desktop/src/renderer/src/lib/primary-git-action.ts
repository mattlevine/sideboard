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
  | 'merge';

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
}): PrimaryGitAction {
  if (opts.prMerged) return 'live';
  if (opts.prClosed) return 'closed';
  if (opts.cowboy) return opts.hasLocalChanges ? 'cowboy-commit-push' : 'cowboy-push';
  if (!opts.hasPr) return 'create-pr';
  if (opts.inMergeQueue) return 'queued';
  if (opts.mergeConflicts) return 'resolve';
  if (opts.branchBehind) return 'update';
  if (opts.hasLocalChanges) return 'commit-push';
  if (opts.prDraft) return opts.originInSync ? 'ready-for-review' : 'commit-push';
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
    case 'merge':
      return '⤵';
  }
}
