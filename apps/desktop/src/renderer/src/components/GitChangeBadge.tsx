export interface GitFileChange {
  status: string;
  additions?: number;
  deletions?: number;
}

/** Status letter (M/A/D…) plus optional +N −M counts — matches Changes/tab chrome. */
export function GitChangeBadge({
  change,
  compact = false,
}: {
  change: GitFileChange;
  /** Tabs: letter only (screenshot-style "M"). */
  compact?: boolean;
}) {
  const letter = (change.status?.[0] ?? 'M').toUpperCase();
  const add = change.additions;
  const del = change.deletions;
  const showCounts =
    !compact && ((add != null && add > 0) || (del != null && del > 0));

  return (
    <span className={`git-change-badge status-${letter.toLowerCase()}`} title={change.status}>
      <span className="git-change-letter">{letter}</span>
      {showCounts && (
        <span className="git-change-counts">
          {add != null && add > 0 && <span className="add">+{add}</span>}
          {del != null && del > 0 && <span className="del">-{del}</span>}
        </span>
      )}
    </span>
  );
}

export function fileChangeMap(
  files: Array<{
    path: string;
    status: string;
    additions?: number;
    deletions?: number;
  }>,
): Record<string, GitFileChange> {
  const map: Record<string, GitFileChange> = {};
  for (const f of files) {
    map[f.path] = {
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    };
  }
  return map;
}
