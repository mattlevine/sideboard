import { getOrchestrator } from '../orchestrator/orchestrator.js';
import { isGlobalThread } from '../store/global-workspace.js';
import type { Thread } from '../types/thread.js';

/** Actions the phone header can ask the Mac to run. Opens stay on the phone. */
export const PHONE_HEADER_GIT_ACTIONS = [
  'commit-push',
  'create-draft',
  'resolve-conflicts',
  'ready-for-review',
  'merge',
] as const;

export type PhoneHeaderGitAction = (typeof PHONE_HEADER_GIT_ACTIONS)[number];

export type PhoneHeaderAction = PhoneHeaderGitAction | 'open-pr' | 'open-checks';

export interface PhoneHeader {
  visible: boolean;
  branch: string;
  additions: number;
  deletions: number;
  unpushed: number;
  dirty: boolean;
  /** False until a diff has landed — counts are not trustworthy yet. */
  ready: boolean;
  title: string;
  prUrl?: string;
  prNumber?: string;
  prStatus?: string;
  action?: PhoneHeaderAction;
  actionLabel?: string;
}

export type PhoneHeaderThread = Pick<
  Thread,
  | 'branchName'
  | 'repoPath'
  | 'prUrl'
  | 'prState'
  | 'prIsDraft'
  | 'prReviewDecision'
  | 'prMergeable'
  | 'prMergeStateStatus'
  | 'prIsInMergeQueue'
  | 'prChecksFailed'
  | 'cowboy'
>;

export type PhoneHeaderDiff = {
  dirty: boolean;
  unpushed: number;
  scopeStats?: { uncommitted?: { additions?: number; deletions?: number } };
};

const HIDDEN: PhoneHeader = {
  visible: false,
  branch: '',
  additions: 0,
  deletions: 0,
  unpushed: 0,
  dirty: false,
  ready: false,
  title: '',
};

/** Same right-sidebar header the desktop paints, from the thread cache plus one diff. */
export function phoneHeaderFrom(thread: PhoneHeaderThread, diff: PhoneHeaderDiff | null): PhoneHeader {
  if (isGlobalThread(thread)) return HIDDEN;
  const branch = thread.branchName.trim().replace(/^thread\//, '');
  if (!branch) return HIDDEN;

  const ready = diff != null;
  const uncommitted = diff?.scopeStats?.uncommitted;
  const additions = ready ? Math.max(0, Math.trunc(uncommitted?.additions ?? 0)) : 0;
  const deletions = ready ? Math.max(0, Math.trunc(uncommitted?.deletions ?? 0)) : 0;
  const unpushed = ready ? Math.max(0, Math.trunc(diff?.unpushed ?? 0)) : 0;
  const dirty = ready && (Boolean(diff?.dirty) || additions > 0 || deletions > 0);
  const pr = prSnapshot(thread);
  const action = ready ? headerAction(pr, { dirty: Boolean(diff?.dirty), unpushed }) : null;

  const lines = [branch];
  if (!ready) lines.push('Loading git status…');
  else if (dirty) lines.push(`Uncommitted +${additions} −${deletions}`);
  else lines.push('Working tree clean');
  if (unpushed > 0) lines.push(`${unpushed} unpushed commit${unpushed === 1 ? '' : 's'}`);

  return {
    visible: true,
    branch,
    additions,
    deletions,
    unpushed,
    dirty,
    ready,
    title: lines.join('\n'),
    ...(pr.url ? { prUrl: pr.url } : {}),
    ...(pr.number ? { prNumber: pr.number } : {}),
    ...(pr.status ? { prStatus: pr.status } : {}),
    ...(action ? { action: action.id, actionLabel: action.label } : {}),
  };
}

/** Pull-request chip for the phone header. Same number and status as the desktop pill. */
export function phonePrPill(
  thread: PhoneHeaderThread,
): { url: string; number: string; status: string } | null {
  const pr = prSnapshot(thread);
  if (!pr.url) return null;
  return { url: pr.url, number: pr.number, status: pr.status };
}

export async function readPhoneHeader(thread: Thread): Promise<PhoneHeader> {
  const pending = phoneHeaderFrom(thread, null);
  if (!pending.visible) return pending;
  try {
    const diff = await getOrchestrator().diff(thread.id, { includePatches: false });
    return phoneHeaderFrom(thread, diff);
  } catch {
    return pending;
  }
}

type PrSnap = {
  url: string;
  number: string;
  status: string;
  merged: boolean;
  closed: boolean;
  open: boolean;
  draft: boolean;
  cowboy: boolean;
  inMergeQueue: boolean;
  mergeConflicts: boolean;
  branchBehind: boolean;
  checksFailed: boolean;
  review: string;
};

function prSnapshot(thread: PhoneHeaderThread): PrSnap {
  const url = thread.prUrl?.trim() || '';
  const number = url.match(/\/pull\/(\d+)/)?.[1] ?? '';
  const state = (thread.prState ?? '').toUpperCase();
  const merged = state === 'MERGED';
  const closed = state === 'CLOSED';
  const open = Boolean(url) && !merged && !closed;
  const draft = open && Boolean(thread.prIsDraft);
  const inMergeQueue = open && Boolean(thread.prIsInMergeQueue);
  const mergeable = (thread.prMergeable ?? '').toUpperCase();
  const mergeState = (thread.prMergeStateStatus ?? '').toUpperCase();
  const mergeConflicts = open && !inMergeQueue && (mergeable === 'CONFLICTING' || mergeState === 'DIRTY');
  const branchBehind = open && !inMergeQueue && !mergeConflicts && mergeState === 'BEHIND';
  const checksFailed = Boolean(thread.prChecksFailed);
  const review = (open && !draft ? thread.prReviewDecision : '') ?? '';
  return {
    url,
    number,
    status: pillStatus({ url, merged, closed, draft, inMergeQueue, mergeConflicts, branchBehind, checksFailed, review }),
    merged,
    closed,
    open,
    draft,
    cowboy: Boolean(thread.cowboy),
    inMergeQueue,
    mergeConflicts,
    branchBehind,
    checksFailed,
    review: review.toUpperCase(),
  };
}

function pillStatus(pr: {
  url: string;
  merged: boolean;
  closed: boolean;
  draft: boolean;
  inMergeQueue: boolean;
  mergeConflicts: boolean;
  branchBehind: boolean;
  checksFailed: boolean;
  review: string;
}): string {
  if (!pr.url) return '';
  if (pr.merged) return 'Merged';
  if (pr.closed) return 'Closed';
  if (pr.inMergeQueue) return 'Queued';
  if (pr.mergeConflicts) return 'Merge conflicts';
  if (pr.branchBehind) return 'Behind base';
  if (pr.draft) return 'Draft';
  if (pr.checksFailed) return 'Checks failing';
  if (pr.review === 'CHANGES_REQUESTED') return 'Changes requested';
  if (pr.review !== 'APPROVED') return 'Needs approval';
  return 'Approved';
}

function headerAction(
  pr: PrSnap,
  diff: { dirty: boolean; unpushed: number },
): { id: PhoneHeaderAction; label: string } | null {
  const hasLocalChanges = diff.dirty || diff.unpushed > 0;
  const originInSync = !hasLocalChanges;
  if (pr.merged) return null;
  if (pr.closed) return { id: 'open-pr', label: 'Closed' };
  if (pr.cowboy) {
    return hasLocalChanges
      ? { id: 'commit-push', label: 'Commit & push' }
      : { id: 'commit-push', label: 'Push' };
  }
  if (!pr.url) return { id: 'create-draft', label: 'Create PR' };
  if (pr.inMergeQueue) return { id: 'open-pr', label: 'Queued' };
  if (pr.mergeConflicts) return { id: 'resolve-conflicts', label: 'Resolve' };
  if (pr.branchBehind) return { id: 'resolve-conflicts', label: 'Update' };
  if (hasLocalChanges) return { id: 'commit-push', label: 'Commit & push' };
  if (pr.draft) {
    return originInSync
      ? { id: 'ready-for-review', label: 'Ready for review' }
      : { id: 'commit-push', label: 'Commit & push' };
  }
  if (pr.checksFailed) return { id: 'open-checks', label: 'Checks failing' };
  if (pr.review === 'CHANGES_REQUESTED') return { id: 'open-pr', label: 'Changes requested' };
  if (pr.review !== 'APPROVED') return { id: 'open-pr', label: 'Needs approval' };
  return { id: 'merge', label: 'Merge' };
}
