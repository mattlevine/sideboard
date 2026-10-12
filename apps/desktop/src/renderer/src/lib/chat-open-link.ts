import { lineRangeFromHash, type FilePathLink } from './file-path-link';
import { isFilesPane, isSchemaPane, type RightPaneContent } from './right-pane';

const ARTIFACT_RE = /^sideboard:\/\/artifact\/([^#?]+?)\/?(?:#.*)?$/i;
const FILE_RE = /^sideboard:\/\/file\/([^?#]*?)\/?(?:#([^?#]*))?$/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** `sideboard://artifact/<artifact_id or title>`. */
export function parseArtifactLink(href: string): string | null {
  const match = ARTIFACT_RE.exec(href.trim());
  if (!match?.[1]) return null;
  const ref = safeDecode(match[1]).trim();
  return ref || null;
}

/** `sideboard://file/<repo-relative-path>#L12-L40`. */
export function parseSideboardFileLink(href: string): FilePathLink | null {
  const match = FILE_RE.exec(href.trim());
  if (!match) return null;
  const path = safeDecode(match[1] ?? '')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
  if (!path || path.startsWith('/') || path.split('/').includes('..')) return null;
  const range = match[2] ? lineRangeFromHash(`#${match[2]}`) : {};
  return { path, ...range };
}

function idAliases(pane: RightPaneContent): string[] {
  const aliases = [pane.id];
  for (const prefix of ['tool-', 'schema-', 'files-']) {
    if (pane.id.startsWith(prefix) && pane.id.length > prefix.length) {
      aliases.push(pane.id.slice(prefix.length));
    }
  }
  if (isSchemaPane(pane) && pane.resourceId) aliases.push(pane.resourceId);
  if (isFilesPane(pane) && pane.path) aliases.push(pane.path);
  return aliases;
}

function sameRef(value: string, needle: string): boolean {
  return value.trim().toLowerCase() === needle;
}

/**
 * Newest pane whose id, tool/schema/files id, or title matches `ref`.
 * Id matches win over title matches.
 */
export function findRightPaneByRef(
  panes: readonly RightPaneContent[],
  ref: string,
): RightPaneContent | null {
  const needle = safeDecode(ref).trim().toLowerCase();
  if (!needle) return null;
  let titleHit: RightPaneContent | null = null;
  let idHit: RightPaneContent | null = null;
  for (const pane of panes) {
    if (sameRef(pane.title, needle)) titleHit = pane;
    if (idAliases(pane).some((alias) => sameRef(alias, needle))) idHit = pane;
  }
  return idHit ?? titleHit;
}
