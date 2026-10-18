import type { IssueInfo } from '../types/thread.js';

function assigneeKey(assignee?: string | null): string {
  return (assignee ?? '').trim().toLowerCase();
}

export function issueMatchesAssignee(
  issue: Pick<IssueInfo, 'assignee' | 'assignees'>,
  assignee?: string | null,
  viewerName = '',
): boolean {
  const key = assigneeKey(assignee);
  if (!key || key === 'all' || key === '*') return true;
  const names = [...(issue.assignees ?? []), issue.assignee ?? '']
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (key === 'unassigned' || key === 'none' || key === 'null') {
    return names.length === 0;
  }
  if (key === 'me' || key === '@me') {
    const me = viewerName.trim().toLowerCase();
    return Boolean(me && names.includes(me));
  }
  return names.includes(key);
}
