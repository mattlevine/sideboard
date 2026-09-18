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

const SEARCH_HIGHLIGHT = 'chat-search';
const SEARCH_HIGHLIGHT_CURRENT = 'chat-search-current';
const SEARCH_MARK = 'chat-search-hit';

function cssHighlightRegistry(): HighlightRegistry | null {
  const css = typeof CSS !== 'undefined' ? CSS : undefined;
  return css && 'highlights' in css ? css.highlights : null;
}

/** Paint via CSS Custom Highlight API — do not wrap React text nodes. */
export function clearChatSearchHighlights(root?: HTMLElement | null): void {
  const registry = cssHighlightRegistry();
  registry?.delete(SEARCH_HIGHLIGHT);
  registry?.delete(SEARCH_HIGHLIGHT_CURRENT);
  if (!root) return;
  for (const mark of [...root.querySelectorAll(`mark.${SEARCH_MARK}`)]) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

function rangeAnchor(range: Range): HTMLElement | null {
  const node = range.startContainer;
  if (node instanceof HTMLElement) return node;
  return node.parentElement;
}

/** Highlight visible matches without mutating the transcript DOM. */
export function applyChatSearchHighlightRanges(
  root: HTMLElement,
  ranges: Range[],
  currentIndex: number,
): HTMLElement | null {
  clearChatSearchHighlights(root);
  if (!ranges.length) return null;
  const idx = Math.min(Math.max(currentIndex, 0), ranges.length - 1);
  const current = ranges[idx];
  const registry = cssHighlightRegistry();
  if (registry && typeof Highlight !== 'undefined') {
    const rest = ranges.filter((_, i) => i !== idx);
    if (rest.length) registry.set(SEARCH_HIGHLIGHT, new Highlight(...rest));
    if (current) registry.set(SEARCH_HIGHLIGHT_CURRENT, new Highlight(current));
  }
  return current ? rangeAnchor(current) : null;
}

export function nextChatSearchIndex(current: number, total: number, delta: 1 | -1): number {
  if (total <= 0) return 0;
  return (current + delta + total) % total;
}

export function shouldDeferChatFind(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
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
