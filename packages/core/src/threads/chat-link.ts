/** Deep link to a Sideboard chat (rendered in markdown as a clickable open). */

export const CHAT_LINK_PREFIX = 'sideboard://chat/';

/** Pre-glossary links. Still parsed so old transcripts keep working. */
export const LEGACY_THREAD_LINK_PREFIX = 'sideboard://thread/';

const ID = '[A-Za-z0-9_-]+';
const CHAT_LINK_RE = new RegExp(`^sideboard://(?:chat|thread)/(${ID})/?$`, 'i');
const BARE_CHAT_LINK_RE = new RegExp(
  `(?<!\\]\\()(?<!href=["'])sideboard://(?:chat|thread)/${ID}/?`,
  'gi',
);

/** Canonical deep link for a chat id (full UUID or short prefix). */
export function chatLinkUrl(chatId: string): string {
  return `${CHAT_LINK_PREFIX}${chatId.trim()}`;
}

/** Extract chat id from `sideboard://chat/…` or legacy `sideboard://thread/…`. */
export function parseChatLink(href: string): string | null {
  const match = CHAT_LINK_RE.exec(href.trim());
  return match?.[1] ?? null;
}

/**
 * Turn bare `sideboard://chat/<id>` (or legacy thread URLs) into markdown
 * links so agents that paste the URL without `[text](url)` still get a click.
 */
export function linkifyChatUrls(text: string): string {
  return text.replace(BARE_CHAT_LINK_RE, (url) => {
    const id = parseChatLink(url);
    if (!id) return url;
    const label = id.length > 8 ? id.slice(0, 8) : id;
    return `[${label}](${chatLinkUrl(id)})`;
  });
}
