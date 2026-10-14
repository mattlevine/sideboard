import {
  classifyWorktreeListBadges,
  type WorktreeListBadgeThread,
} from '@sideboard/home-board';

/** Path-to-merge pills on sidebar and Home worktree titles. */
export function WorktreePrBadges({
  group,
  viewerLogin,
  reviewLabel,
}: {
  group: WorktreeListBadgeThread[];
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
      {badges.flatMap((badge) => {
        const status = (
          <span
            key={badge.id}
            className={`board-badge ${badge.mod}${badge.conflict ? ' has-conflict' : ''}`}
            title={badge.title}
          >
            {badge.label}
            {badge.conflict ? <span className="board-badge-conflict" aria-hidden /> : null}
          </span>
        );
        if (!badge.error) return [status];
        return [
          status,
          <span key={`${badge.id}-error`} className="board-badge is-error" title={badge.error.title}>
            {badge.error.label}
          </span>,
        ];
      })}
    </>
  );
}
