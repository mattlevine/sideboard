/** Visible chat prose only — skip tool dumps, thinking, and continue notes. */
export function chatMessageSearchText(message: {
  text?: string;
  origin?: string;
  parts?: Array<{ type: string; text?: string; description?: string; name?: string }>;
}): string {
  if (message.origin === 'continue') return '';
  const chunks: string[] = [];
  const seen = new Set<string>();
  const add = (value?: string) => {
    const text = value?.trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    chunks.push(text);
  };
  add(message.text);
  for (const part of message.parts ?? []) {
    if (part.type === 'text') add(part.text);
    if (part.type === 'tool') {
      add(part.description);
      add(part.name);
    }
  }
  return chunks.join('\n');
}

export function chatSearchQuery(raw: string): string {
  return raw.trim().slice(0, 200);
}

/** Seed from a menu/IPC query, else the current text selection. */
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

function pushOccurrenceHits(hits: string[], key: string, haystack: string, query: string): void {
  const n = findQueryOffsets(haystack, query).length;
  for (let i = 0; i < n; i++) hits.push(key);
}

/**
 * Message keys in transcript order (`msg-0`, `pending`, `live`).
 * One entry per occurrence so next/prev walks each match.
 */
export function findChatSearchHits(
  query: string,
  messages: Array<{
    text?: string;
    origin?: string;
    parts?: Array<{ type: string; text?: string; description?: string; name?: string }>;
  }>,
  extras?: { pending?: string | null; live?: string | null },
): string[] {
  const q = chatSearchQuery(query);
  if (!q) return [];
  const hits: string[] = [];
  messages.forEach((message, i) => {
    pushOccurrenceHits(hits, `msg-${i}`, chatMessageSearchText(message), q);
  });
  if (extras?.pending) pushOccurrenceHits(hits, 'pending', extras.pending, q);
  if (extras?.live) pushOccurrenceHits(hits, 'live', extras.live, q);
  return hits;
}

const SEARCH_TEXT_SCOPE = '[data-chat-text], .turn-summary-text';
const SEARCH_TEXT_SKIP = '.chat-search-bar, .msg-continue, script, style, svg';

export function collectChatSearchRanges(root: HTMLElement, query: string): Range[] {
  const q = chatSearchQuery(query);
  if (!q || typeof document === 'undefined') return [];
  const ranges: Range[] = [];
  for (const scope of root.querySelectorAll(SEARCH_TEXT_SCOPE)) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = (node as Text).parentElement;
        if (!parent || parent.closest(SEARCH_TEXT_SKIP)) return NodeFilter.FILTER_REJECT;
        return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? '';
      for (const start of findQueryOffsets(text, q)) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + q.length);
        ranges.push(range);
      }
    }
  }
  return ranges;
}

const SEARCH_MARK = 'chat-search-hit';
const SEARCH_MARK_CURRENT = 'chat-search-current';

export function clearChatSearchHighlights(root?: HTMLElement | null): void {
  if (!root) return;
  for (const mark of [...root.querySelectorAll(`mark.${SEARCH_MARK}`)]) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

function wrapRange(range: Range): HTMLMarkElement | null {
  const mark = document.createElement('mark');
  mark.className = SEARCH_MARK;
  try {
    range.surroundContents(mark);
    return mark;
  } catch {
    return null;
  }
}

/** Wrap each visible match. Later ranges first so earlier offsets stay valid. */
export function applyChatSearchHighlightRanges(
  root: HTMLElement,
  ranges: Range[],
  currentIndex: number,
): HTMLElement | null {
  clearChatSearchHighlights(root);
  const marks: Array<HTMLMarkElement | null> = new Array(ranges.length).fill(null);
  for (let i = ranges.length - 1; i >= 0; i--) {
    marks[i] = wrapRange(ranges[i]);
  }
  const current = ranges.length
    ? marks[Math.min(Math.max(currentIndex, 0), ranges.length - 1)]
    : null;
  if (current) current.classList.add(SEARCH_MARK_CURRENT);
  return current;
}

export function nextChatSearchIndex(current: number, total: number, delta: 1 | -1): number {
  if (total <= 0) return 0;
  return (current + delta + total) % total;
}

export function shouldDeferChatFind(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('.chat-search-bar, .composer-shell')) return false;
  return Boolean(
    target.closest('.monaco-editor, .xterm, .xterm-helper-textarea, input, textarea, [contenteditable="true"]'),
  );
}

export function scrollChatToSearchKey(chatEl: HTMLElement, key: string): void {
  const safeKey = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(key) : key;
  const hit = chatEl.querySelector(`[data-chat-search-key="${safeKey}"]`);
  if (!(hit instanceof HTMLElement)) return;
  scrollChatToElement(chatEl, hit);
}

export function scrollChatToElement(chatEl: HTMLElement, hit: HTMLElement): void {
  const chatRect = chatEl.getBoundingClientRect();
  const hitRect = hit.getBoundingClientRect();
  chatEl.scrollTop += hitRect.top - chatRect.top - Math.max(24, chatEl.clientHeight / 4);
}
