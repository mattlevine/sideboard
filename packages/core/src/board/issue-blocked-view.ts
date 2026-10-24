/** Identifiers of issues that block a worktree's source ticket. */
export function issueBlockedByIds(
  group: Array<{ issueBlockedBy?: string[] | null }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const thread of group) {
    for (const raw of thread.issueBlockedBy ?? []) {
      const id = String(raw ?? '').trim();
      const key = id.toLowerCase();
      if (!id || seen.has(key)) continue;
      seen.add(key);
      out.push(id);
    }
  }
  return out;
}

/** Short pill: one or two ids, otherwise a count. */
export function issueBlockedLabel(ids: string[]): string {
  if (ids.length === 0) return '';
  if (ids.length <= 2) return `blocked by ${ids.join(', ')}`;
  return `blocked by ${ids.length}`;
}
