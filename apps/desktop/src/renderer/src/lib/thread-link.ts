import { parseArtifactLink, parseSideboardFileLink } from './chat-open-link';

/** Deep link to a Sideboard chat (legacy thread:// still parsed). */

export const THREAD_LINK_PREFIX = 'sideboard://chat/';

const LINK_RE = /^sideboard:\/\/(?:chat|thread)\/([A-Za-z0-9_-]+)\/?$/i;
const BARE_LINK_RE =
  /(?<!\]\()(?<!href=["'])sideboard:\/\/(?:(?:chat|thread)\/[A-Za-z0-9_-]+\/?|artifact\/[^\s)]+|file\/[^\s)]+)/gi;

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
 * Allow sideboard://chat|artifact|file URLs through react-markdown's
 * URL sanitizer (default only keeps http/https/mailto/irc/xmpp).
 */
function sideboardOpenLink(value: string): boolean {
  return Boolean(
    parseThreadLink(value) || parseArtifactLink(value) || parseSideboardFileLink(value),
  );
}

function linkifyLabel(url: string): string {
  const threadId = parseThreadLink(url);
  if (threadId) return threadId.length > 8 ? threadId.slice(0, 8) : threadId;
  const artifact = parseArtifactLink(url);
  if (artifact) return artifact.length > 28 ? `${artifact.slice(0, 28)}…` : artifact;
  const file = parseSideboardFileLink(url);
  if (file) {
    const base = file.path.split('/').pop() || file.path;
    if (file.startLine == null) return base;
    return file.endLine != null ? `${base}:${file.startLine}-${file.endLine}` : `${base}:${file.startLine}`;
  }
  return url;
}

export function markdownUrlTransform(value: string): string {
  if (sideboardOpenLink(value)) return value;
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

/** Turn bare sideboard://chat|artifact|file URLs into markdown links. */
export function linkifyThreadUrls(text: string): string {
  return text.replace(BARE_LINK_RE, (url) => {
    if (!sideboardOpenLink(url)) return url;
    const threadId = parseThreadLink(url);
    const href = threadId ? threadLinkUrl(threadId) : url;
    return `[${linkifyLabel(url)}](${href})`;
  });
}
