/** Deep link to a Sideboard chat. Matches packages/core chat-link.ts. */

const ID = '[A-Za-z0-9_-]+';
const CHAT_LINK_RE = new RegExp(`^sideboard://(?:chat|thread)/(${ID})/?$`, 'i');
const BARE_CHAT_LINK_RE = new RegExp(
  `(?<!\\]\\()(?<!href=["'])sideboard://(?:chat|thread)/${ID}/?`,
  'gi',
);

export function parseChatLink(href: string): string | null {
  const match = CHAT_LINK_RE.exec(href.trim());
  return match?.[1] ?? null;
}

/** Turn a bare sideboard://chat/<id> into a markdown link so it stays tappable. */
export function linkifyChatUrls(text: string): string {
  return text.replace(BARE_CHAT_LINK_RE, (url) => {
    const id = parseChatLink(url);
    if (!id) return url;
    const label = id.length > 8 ? id.slice(0, 8) : id;
    return `[${label}](sideboard://chat/${id})`;
  });
}
