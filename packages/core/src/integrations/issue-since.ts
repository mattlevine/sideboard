/** Shared `updatedSince` parsing for Linear / GitHub / AbleTime inbox queries. */

export const ISSUE_SINCE_ERROR =
  'updatedSince must be an ISO datetime, YYYY-MM-DD, or relative time (yesterday, 2d, 3 hours ago)';

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const RELATIVE_RE =
  /^(\d+)\s*(hours?|hrs?|h|days?|d|weeks?|wks?|w)(?:\s+ago)?$/i;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Parse a since bound to UTC ISO.
 * Date-only and calendar relatives (yesterday, 2d, last week) use local midnight
 * so “since yesterday” matches the user’s day, not UTC’s.
 */
export function parseIssueSince(input: string, now = new Date()): string {
  const raw = input.trim();
  if (!raw) throw new Error(ISSUE_SINCE_ERROR);

  const dateOnly = raw.match(DATE_ONLY_RE);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const local = new Date(year, month - 1, day);
    if (
      local.getFullYear() !== year ||
      local.getMonth() !== month - 1 ||
      local.getDate() !== day
    ) {
      throw new Error(ISSUE_SINCE_ERROR);
    }
    return startOfLocalDay(local).toISOString();
  }

  if (DATE_TIME_RE.test(raw)) {
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) throw new Error(ISSUE_SINCE_ERROR);
    return new Date(ms).toISOString();
  }

  const lower = raw.toLowerCase();
  if (lower === 'today') return startOfLocalDay(now).toISOString();
  if (lower === 'yesterday') return addLocalDays(startOfLocalDay(now), -1).toISOString();
  if (lower === 'last week' || lower === 'lastweek') {
    return addLocalDays(startOfLocalDay(now), -7).toISOString();
  }

  const relative = lower.match(RELATIVE_RE);
  if (relative) {
    const n = Number(relative[1]);
    if (!Number.isInteger(n) || n < 1) throw new Error(ISSUE_SINCE_ERROR);
    const unit = relative[2];
    if (unit.startsWith('h')) return new Date(now.getTime() - n * 3_600_000).toISOString();
    if (unit.startsWith('w')) return addLocalDays(startOfLocalDay(now), -7 * n).toISOString();
    return addLocalDays(startOfLocalDay(now), -n).toISOString();
  }

  throw new Error(ISSUE_SINCE_ERROR);
}

/** GitHub issue search `updated:>=` token (full ISO so local midnight is not shifted to UTC date). */
export function formatGitHubSearchUpdatedSince(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, 'Z');
}

export function issueMatchesUpdatedSince(
  issue: { createdAt?: string; updatedAt?: string },
  sinceIso: string,
): boolean {
  const ts = issue.updatedAt || issue.createdAt;
  if (!ts) return false;
  const value = Date.parse(ts);
  const since = Date.parse(sinceIso);
  return Number.isFinite(value) && Number.isFinite(since) && value >= since;
}

export const ISSUE_COMMENT_PREVIEW_CHARS = 240;

export function previewIssueCommentBody(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= ISSUE_COMMENT_PREVIEW_CHARS) return flat;
  return `${flat.slice(0, ISSUE_COMMENT_PREVIEW_CHARS - 1).trimEnd()}…`;
}

export function issueActivityKind(
  issue: { createdAt?: string },
  sinceIso: string,
): 'created' | 'updated' {
  const created = issue.createdAt ? Date.parse(issue.createdAt) : Number.NaN;
  const since = Date.parse(sinceIso);
  if (Number.isFinite(created) && Number.isFinite(since) && created >= since) return 'created';
  return 'updated';
}
