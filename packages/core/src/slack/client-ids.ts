/** Deduped Slack app client ids. Order is the order they were added. */
export function mergeSlackClientIds(ids: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw?.trim() ?? '';
    if (!id || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}
