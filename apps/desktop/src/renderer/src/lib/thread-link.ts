/** Deep link to a Sideboard thread chat (rendered in markdown as a clickable link). */
export const THREAD_LINK_PREFIX = 'sideboard://thread/';

const THREAD_LINK_RE = /^sideboard:\/\/thread\/([A-Za-z0-9_-]+)\/?$/i;
const BARE_THREAD_LINK_RE = /(?<!\]\()(?<!href=["'])sideboard:\/\/thread\/[A-Za-z0-9_-]+\/?/gi;

/** Build a markdown-safe deep link for a thread id (full or short prefix). */
export function threadLinkUrl(threadId: string): string {
  return `${THREAD_LINK_PREFIX}${threadId.trim()}`;
}

/** Extract thread id/ref from a sideboard://thread/… href. */
export function parseThreadLink(href: string): string | null {
  const trimmed = href.trim();
  const match = THREAD_LINK_RE.exec(trimmed);
  return match?.[1] ?? null;
}

/**
 * Allow sideboard://thread/… through react-markdown's URL sanitizer
 * (default only keeps http/https/mailto/irc/xmpp).
 */
export function markdownUrlTransform(value: string): string {
  if (parseThreadLink(value)) return value;
  // Mirror react-markdown defaultUrlTransform for everything else.
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

/**
 * Turn bare `sideboard://thread/<id>` text into markdown links so agents that
 * paste the URL without `[text](url)` still get a clickable control.
 */
export function linkifyThreadUrls(text: string): string {
  return text.replace(BARE_THREAD_LINK_RE, (url) => {
    const id = parseThreadLink(url);
    if (!id) return url;
    const label = id.length > 8 ? id.slice(0, 8) : id;
    return `[${label}](${THREAD_LINK_PREFIX}${id})`;
  });
}
