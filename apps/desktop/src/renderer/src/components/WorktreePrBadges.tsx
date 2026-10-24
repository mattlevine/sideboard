import {
  classifyWorktreeListBadges,
  issueBlockedByIds,
  type WorktreeListBadgeThread,
} from '@sideboard/home-board';

/** Path-to-merge pills on sidebar and Home worktree titles. */
export function WorktreePrBadges({
  group,
  viewerLogin,
  reviewLabel,
}: {
  group: Array<WorktreeListBadgeThread>;
  viewerLogin?: string | null;
  reviewLabel?: string | null;
}) {
  const badges = classifyWorktreeListBadges(
    group,
    viewerLogin ?? '',
    reviewLabel ?? '',
  );
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map((badge) => (
        <span
          key={badge.id}
          className={`board-badge ${badge.mod}${badge.conflict ? ' has-conflict' : ''}`}
          title={badge.title}
        >
          {badge.label}
          {badge.conflict ? <span className="board-badge-conflict" aria-hidden /> : null}
        </span>
      ))}
    </>
  );
}

/** Readable line under a worktree title when its source ticket is blocked. */
export function IssueBlockedLine({
  group,
}: {
  group: Array<{ issueBlockedBy?: string[] | null }>;
}) {
  const ids = issueBlockedByIds(group);
  if (ids.length === 0) return null;
  const text = `Blocked by ${ids.join(', ')}`;
  return (
    <div className="thread-blocked-reason" title={text}>
      {text}
    </div>
  );
}
