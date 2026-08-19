import type { PrCheckRun } from '@sideboard-ai/core';

/** Aggregate GitHub `reviewDecision` label for PR pill / Review tab. */
export function formatReviewDecision(decision: string | null | undefined): string | null {
  if (!decision) return null;
  switch (decision.toUpperCase()) {
    case 'CHANGES_REQUESTED':
      return 'Rejected';
    case 'REVIEW_REQUIRED':
      return 'Needs approval';
    case 'APPROVED':
      return 'Approved';
    default:
      return decision.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}

/** CSS modifier for the top-right PR pill based on lifecycle + review state. */
export function prPillModifier(opts: {
  merged: boolean;
  closed: boolean;
  draft: boolean;
  reviewDecision: string | null | undefined;
  /** Open PR cannot merge until conflicts are resolved. */
  mergeConflicts?: boolean;
  /** Head is behind the PR base (needs update before merge). */
  branchBehind?: boolean;
  /** Open PR is waiting in a GitHub merge queue. */
  inMergeQueue?: boolean;
  /** CI failed (from `gh pr checks`). */
  checksFailed?: boolean;
  /** CI still running; no failures yet. */
  checksPending?: boolean;
  /** At least one CI check passed and none are failing/pending. */
  checksPassed?: boolean;
}): string {
  if (opts.merged) return 'merged';
  if (opts.closed) return 'closed';
  if (opts.inMergeQueue) return 'queued';
  if (opts.mergeConflicts || opts.branchBehind) return 'conflicts';
  if (opts.draft) return 'draft';
  if (opts.checksFailed) return 'rejected';
  const decision = (opts.reviewDecision ?? '').toUpperCase();
  if (decision === 'REVIEW_REQUIRED') return 'needs-approval';
  if (decision === 'CHANGES_REQUESTED') return 'rejected';
  if (opts.checksPending) return 'needs-approval';
  if (decision === 'APPROVED' || opts.checksPassed) return 'approved';
  return 'open';
}

/** Status badge text for the top-right PR pill. */
export function prPillStatusLabel(opts: {
  merged: boolean;
  closed: boolean;
  draft: boolean;
  reviewDecision: string | null | undefined;
  mergeConflicts?: boolean;
  branchBehind?: boolean;
  inMergeQueue?: boolean;
  baseRefName?: string | null;
  checksFailed?: boolean;
  checksPending?: boolean;
  checksPassed?: boolean;
}): string {
  if (opts.merged) return 'Merged';
  if (opts.closed) return 'Closed';
  if (opts.inMergeQueue) return 'Queued';
  if (opts.mergeConflicts) return 'Merge conflicts';
  if (opts.branchBehind) {
    const base = (opts.baseRefName ?? '').replace(/^refs\/heads\//, '').trim();
    return base ? `Behind ${base}` : 'Behind base';
  }
  if (opts.draft) return 'Draft';
  if (opts.checksFailed) return 'Checks failing';
  const review = formatReviewDecision(opts.reviewDecision);
  if (review === 'Needs approval' || review === 'Rejected') return review;
  if (opts.checksPending) return 'Checks pending';
  if (review) return review;
  if (opts.checksPassed) return 'Checks passing';
  return 'Open';
}

export function classifyMergeIssue(opts: {
  mergeable?: string | null;
  mergeStateStatus?: string | null;
  inMergeQueue?: boolean;
}): 'conflicts' | 'behind' | null {
  if (opts.inMergeQueue) return null;
  const mergeable = (opts.mergeable ?? '').toUpperCase();
  const mergeState = (opts.mergeStateStatus ?? '').toUpperCase();
  if (mergeable === 'CONFLICTING' || mergeState === 'DIRTY') return 'conflicts';
  if (mergeState === 'BEHIND') return 'behind';
  return null;
}

/** True when Checks include a failing mergeability conflict row. */
export function hasMergeConflictChecks(
  checks: Array<Pick<PrCheckRun, 'kind' | 'state' | 'name'>> | null | undefined,
): boolean {
  if (!checks?.length) return false;
  return checks.some((c) => {
    if (c.kind === 'mergeability') {
      const state = (c.state ?? '').toUpperCase();
      return state === 'CONFLICTING' || state === 'DIRTY';
    }
    return /merge conflicts/i.test(c.name ?? '');
  });
}

/** True when Checks include a failing behind-base mergeability row. */
export function hasBranchBehindChecks(
  checks: Array<Pick<PrCheckRun, 'kind' | 'state' | 'name'>> | null | undefined,
): boolean {
  if (!checks?.length) return false;
  return checks.some((c) => {
    if (c.kind === 'mergeability') {
      return (c.state ?? '').toUpperCase() === 'BEHIND';
    }
    return /branch behind/i.test(c.name ?? '');
  });
}

export function formatCheckDuration(check: PrCheckRun): string {
  if (!check.startedAt || !check.completedAt) return '';
  const start = Date.parse(check.startedAt);
  const end = Date.parse(check.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s` : `${min}m`;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function checkStatusLabel(check: Pick<PrCheckRun, 'bucket' | 'state' | 'kind'>): string {
  if (check.kind === 'mergeability' || check.kind === 'review') {
    switch ((check.state ?? '').toUpperCase()) {
      case 'CONFLICTING':
      case 'DIRTY':
        return 'Conflict';
      case 'BEHIND':
        return 'Behind';
      case 'BLOCKED':
        return 'Blocked';
      case 'CHANGES_REQUESTED':
        return 'Rejected';
      case 'REVIEW_REQUIRED':
        return 'Needs approval';
      case 'UNKNOWN':
        return 'Checking…';
      case 'QUEUED':
        return 'Queued';
      default:
        break;
    }
  }
  switch (check.bucket) {
    case 'pass':
      return 'Passed';
    case 'fail':
      return 'Failed';
    case 'pending':
      return 'Pending';
    case 'skipping':
      return 'Skipped';
    case 'cancel':
      return 'Cancelled';
    default:
      return check.bucket || 'Unknown';
  }
}

export function summarizeChecks(checks: PrCheckRun[]): {
  failed: number;
  pending: number;
  passed: number;
  total: number;
  label: string;
} {
  let failed = 0;
  let pending = 0;
  let passed = 0;
  for (const c of checks) {
    if (c.bucket === 'fail') failed++;
    else if (c.bucket === 'pending') pending++;
    else if (c.bucket === 'pass') passed++;
  }
  const total = checks.length;
  let label = '';
  if (total === 0) label = '';
  else if (failed > 0) label = `Failed (${failed}/${total})`;
  else if (pending > 0) label = `Pending (${pending}/${total})`;
  else label = `Passed (${passed}/${total})`;
  return { failed, pending, passed, total, label };
}

/** Flags for the PR pill from loaded `gh pr checks` rows. */
export function checksFromRuns(checks: PrCheckRun[] | null | undefined): {
  checksFailed: boolean;
  checksPending: boolean;
  checksPassed: boolean;
} {
  if (!checks?.length) {
    return { checksFailed: false, checksPending: false, checksPassed: false };
  }
  const s = summarizeChecks(checks);
  return {
    checksFailed: s.failed > 0,
    checksPending: s.failed === 0 && s.pending > 0,
    checksPassed: s.failed === 0 && s.pending === 0 && s.passed > 0,
  };
}

/** Compact Checks tab label (narrow right sidebar). */
export function checksTabShortLabel(checks: PrCheckRun[] | null | undefined): string {
  if (!checks?.length) return 'CI';
  const s = summarizeChecks(checks);
  if (s.failed > 0) return `CI ${s.failed}✕`;
  if (s.pending > 0) return 'CI …';
  return 'CI ✓';
}
