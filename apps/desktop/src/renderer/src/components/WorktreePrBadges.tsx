import {
  classifyWorktreeListBadges,
  type WorktreeListBadgeThread,
} from '@sideboard/home-board';

/** Lifecycle / problem pills on sidebar and Home worktree titles. */
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
      {badges.map((badge) => (
        <span
          key={badge.id}
          className={`board-badge ${badge.mod}`}
          title={badge.title}
        >
          {badge.label}
        </span>
      ))}
    </>
  );
}
