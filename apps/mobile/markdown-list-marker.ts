/** Immediate list for a phone list row. Ancestors do not decide the marker. */
export function phoneListParent<T extends { type?: string }>(parents: readonly T[]): T | undefined {
  const immediate = parents[0];
  if (immediate?.type === 'ordered_list' || immediate?.type === 'bullet_list') return immediate;
  return undefined;
}

/** Marker for one phone list row. `parent` is that immediate list. */
export function phoneListMarker(
  node: { index: number; markup?: string; attributes?: { task?: string } },
  parent: { type?: string; attributes?: { start?: unknown } } | undefined,
  bullet: string,
): string {
  const task = node.attributes?.task;
  if (task === 'checked') return '\u2611';
  if (task === 'open') return '\u2610';
  if (parent?.type === 'ordered_list') {
    const start = Number(parent.attributes?.start);
    const number = Number.isFinite(start) && start > 0 ? start + node.index : node.index + 1;
    return `${number}${node.markup || '.'}`;
  }
  return bullet;
}
