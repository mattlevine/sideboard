/** Deep link to a Sideboard chat (legacy thread:// still parsed). */

export const THREAD_LINK_PREFIX = 'sideboard://chat/';

const LINK_RE = /^sideboard:\/\/(?:chat|thread)\/([A-Za-z0-9_-]+)\/?$/i;
const BARE_LINK_RE =
  /(?<!\]\()(?<!href=["'])sideboard:\/\/(?:chat|thread)\/[A-Za-z0-9_-]+\/?/gi;

/** Build a markdown-safe deep link for a chat id (full or short prefix). */
export function threadLinkUrl(threadId: string): string {
  return `${THREAD_LINK_PREFIX}${threadId.trim()}`;
}

/** Extract chat id from sideboard://chat/… or legacy sideboard://thread/…. */
export function parseThreadLink(href: string): string | null {
  const match = LINK_RE.exec(href.trim());
  return match?.[1] ?? null;
}

/**
 * Allow sideboard://chat/… and legacy thread URLs through react-markdown's
 * URL sanitizer (default only keeps http/https/mailto/irc/xmpp).
 */
export function markdownUrlTransform(value: string): string {
  if (parseThreadLink(value)) return value;
  const colon = value.indexOf(':');
  const questionMark = value.indexOf('?');
  const numberSign = value.indexOf('#');
  const slash = value.indexOf('/');
  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    /^(https?|ircs?|mailto|xmpp)$/i.test(value.slice(0, colon))
  ) {
    return value;
  }
  return '';
}

/** Turn bare sideboard://chat|thread/<id> text into markdown links. */
export function linkifyThreadUrls(text: string): string {
  return text.replace(BARE_LINK_RE, (url) => {
    const id = parseThreadLink(url);
    if (!id) return url;
    const label = id.length > 8 ? id.slice(0, 8) : id;
    return `[${label}](${threadLinkUrl(id)})`;
  });
}
