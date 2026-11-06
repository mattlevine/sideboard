import { parseSideboardArtifactLink, parseSideboardFileLink } from './file-link';

const ID = '[A-Za-z0-9_-]+';
const CHAT_LINK_RE = new RegExp(`^sideboard://(?:chat|thread)/(${ID})/?$`, 'i');
const BARE_LINK_RE = new RegExp(
  `(?<!\\]\\()(?<!href=["'])sideboard://(?:(?:chat|thread)/${ID}/?|artifact/[^\\s)]+|file/[^\\s)]+)`,
  'gi',
);

export function parseChatLink(href: string): string | null {
  const match = CHAT_LINK_RE.exec(href.trim());
  return match?.[1] ?? null;
}

function linkLabel(url: string): string {
  const id = parseChatLink(url);
  if (id) return id.length > 8 ? id.slice(0, 8) : id;
  const artifact = parseSideboardArtifactLink(url);
  if (artifact) return artifact.length > 28 ? `${artifact.slice(0, 28)}…` : artifact;
  const file = parseSideboardFileLink(url);
  if (file) {
    const base = file.path.split('/').pop() || file.path;
    if (file.startLine == null) return base;
    return file.endLine != null
      ? `${base}:${file.startLine}-${file.endLine}`
      : `${base}:${file.startLine}`;
  }
  return url;
}

/** Turn a bare sideboard://chat|artifact|file URL into a markdown link. */
export function linkifyChatUrls(text: string): string {
  return text.replace(BARE_LINK_RE, (url) => {
    const id = parseChatLink(url);
    if (id) return `[${linkLabel(url)}](sideboard://chat/${id})`;
    if (!parseSideboardArtifactLink(url) && !parseSideboardFileLink(url)) return url;
    return `[${linkLabel(url)}](${url})`;
  });
}
