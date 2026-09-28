import {
  classifyWorktreeListBadges,
  type WorktreeListBadge,
  type WorktreeListBadgeThread,
} from '@sideboard/home-board';

function ReviewingPersonIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
      <circle cx="6" cy="3.4" r="2.1" fill="currentColor" />
      <path
        d="M2.1 10.6c0-2.05 1.75-3.35 3.9-3.35s3.9 1.3 3.9 3.35"
        fill="currentColor"
      />
    </svg>
  );
}

function BadgeMark({ badge }: { badge: WorktreeListBadge }) {
  const icon = badge.id === 'reviewing';
  return (
    <span
      className={`board-badge ${badge.mod}`}
      title={badge.title}
      aria-label={icon ? badge.title : undefined}
      role={icon ? 'img' : undefined}
    >
      {icon ? <ReviewingPersonIcon /> : badge.label}
    </span>
  );
}

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
        <BadgeMark key={badge.id} badge={badge} />
      ))}
    </>
  );
}
