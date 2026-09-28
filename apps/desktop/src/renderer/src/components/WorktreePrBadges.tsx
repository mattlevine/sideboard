import {
  classifyWorktreeListBadges,
  type WorktreeListBadgeThread,
} from '@sideboard/home-board';

/** Lifecycle / problem pills on sidebar and Home worktree titles. */
export function WorktreePrBadges({
  group,
  viewerLogin,
}: {
  group: WorktreeListBadgeThread[];
  viewerLogin?: string | null;
}) {
  const badges = classifyWorktreeListBadges(group, viewerLogin ?? '');
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
