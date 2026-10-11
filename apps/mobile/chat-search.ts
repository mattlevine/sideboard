/** Case-insensitive find for phone chat, matching the desktop query cap. */

export function chatSearchQuery(raw: string): string {
  return raw.trim().slice(0, 200);
}

/** Seed from a menu query, otherwise the current selection. */
export function seedChatSearchQuery(seed?: string | null, selection = ''): string {
  return chatSearchQuery(seed ?? '') || chatSearchQuery(selection);
}

/** Non-overlapping, case-insensitive start offsets. */
export function findQueryOffsets(haystack: string, query: string): number[] {
  const q = chatSearchQuery(query);
  if (!q) return [];
  const h = haystack.toLowerCase();
  const needle = q.toLowerCase();
  const offsets: number[] = [];
  let from = 0;
  let index = h.indexOf(needle, from);
  while (index !== -1) {
    offsets.push(index);
    from = index + needle.length;
    index = h.indexOf(needle, from);
  }
  return offsets;
}

export type HighlightPart = { text: string; match: boolean };

/** Split plain text into match and non-match runs for inline highlight. */
export function highlightSegments(content: string, query: string): HighlightPart[] {
  const q = chatSearchQuery(query);
  if (!q) return [{ text: content, match: false }];
  const offsets = findQueryOffsets(content, q);
  if (!offsets.length) return [{ text: content, match: false }];
  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const start of offsets) {
    if (start > cursor) parts.push({ text: content.slice(cursor, start), match: false });
    parts.push({ text: content.slice(start, start + q.length), match: true });
    cursor = start + q.length;
  }
  if (cursor < content.length) parts.push({ text: content.slice(cursor), match: false });
  return parts;
}

/** One entry per occurrence so next/prev walks each match. `local` is the index inside that bubble. */
export type BubbleSearchHit = { id: string; local: number };

export function findBubbleSearchHits(
  query: string,
  bubbles: Array<{ id: string; text: string }>,
  visibleParts: (text: string) => string[] = (text) => [text],
): BubbleSearchHit[] {
  const q = chatSearchQuery(query);
  if (!q) return [];
  const hits: BubbleSearchHit[] = [];
  for (const bubble of bubbles) {
    let local = 0;
    for (const part of visibleParts(bubble.text)) {
      const n = findQueryOffsets(part, q).length;
      for (let i = 0; i < n; i++) hits.push({ id: bubble.id, local: local++ });
    }
  }
  return hits;
}

export function currentLocalIndex(hits: BubbleSearchHit[], index: number, bubbleId: string): number {
  const hit = hits[index];
  if (!hit || hit.id !== bubbleId) return -1;
  return hit.local;
}

export function nextChatSearchIndex(current: number, total: number, delta: 1 | -1): number {
  if (total <= 0) return 0;
  return (current + delta + total) % total;
}
