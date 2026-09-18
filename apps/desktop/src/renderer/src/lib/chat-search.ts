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

function matches(haystack: string, query: string): boolean {
  if (!query) return false;
  return haystack.toLowerCase().includes(query.toLowerCase());
}

/**
 * Message keys in transcript order (`msg-0`, `pending`, `live`).
 * One hit per matching bubble — jump between messages, not every occurrence.
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
    if (matches(chatMessageSearchText(message), q)) hits.push(`msg-${i}`);
  });
  if (extras?.pending && matches(extras.pending, q)) hits.push('pending');
  if (extras?.live && matches(extras.live, q)) hits.push('live');
  return hits;
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
  const hit = chatEl.querySelector(`[data-chat-search-key="${CSS.escape(key)}"]`);
  if (!(hit instanceof HTMLElement)) return;
  const chatRect = chatEl.getBoundingClientRect();
  const hitRect = hit.getBoundingClientRect();
  chatEl.scrollTop += hitRect.top - chatRect.top - Math.max(24, chatEl.clientHeight / 4);
}
