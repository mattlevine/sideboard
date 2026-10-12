export interface FilePathLink {
  path: string;
  startLine?: number;
  endLine?: number;
}

const CITATION_RE = /^(\d+):(\d+):(.+)$/;
const PATH_LIKE_RE =
  /^(?:\/)?(?:[\w@.-]+\/)+[\w.-]+\.[A-Za-z0-9]+(?:#L\d+(?:-\d+)?)?$|^(?:\/)?(?:[\w@.-]+\/)+[\w.-]+$/;

function lineRange(text: string): { startLine?: number; endLine?: number } {
  const match = /#L(\d+)(?:-L?(\d+))?$/i.exec(text);
  if (!match) return {};
  return {
    startLine: Number(match[1]),
    endLine: match[2] ? Number(match[2]) : undefined,
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const SIDEBOARD_FILE_RE = /^sideboard:\/\/file\/([^?#]*?)\/?(?:#([^?#]*))?$/i;
const SIDEBOARD_ARTIFACT_RE = /^sideboard:\/\/artifact\/([^#?]+?)\/?(?:#.*)?$/i;

/** `sideboard://file/<repo-relative-path>#L12-L40`. */
export function parseSideboardFileLink(href: string): FilePathLink | null {
  const match = SIDEBOARD_FILE_RE.exec(href.trim());
  if (!match) return null;
  const path = safeDecode(match[1] ?? '')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
  if (!path || path.startsWith('/') || path.split('/').includes('..')) return null;
  return { path, ...(match[2] ? lineRange(`#${match[2]}`) : {}) };
}

/** `sideboard://artifact/<artifact_id or title>`. */
export function parseSideboardArtifactLink(href: string): string | null {
  const match = SIDEBOARD_ARTIFACT_RE.exec(href.trim());
  if (!match?.[1]) return null;
  const ref = safeDecode(match[1]).trim();
  return ref || null;
}

/**
 * Same path shapes the desktop turns into file buttons.
 * Absolute paths are passed through; the Mac checks they sit in the worktree.
 */
export function parseFilePathLink(text: string): FilePathLink | null {
  let trimmed = text.trim();
  if (!trimmed || trimmed.includes('..')) return null;
  if (/^file:\/\//i.test(trimmed)) {
    try {
      trimmed = decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return null;
    }
  }
  const citation = CITATION_RE.exec(trimmed);
  if (citation) {
    const path = citation[3]!.trim();
    if (!path) return null;
    return {
      path,
      startLine: Number(citation[1]),
      endLine: Number(citation[2]),
    };
  }
  const range = lineRange(trimmed);
  const stripped = trimmed.replace(/#L\d+(?:-\d+)?$/, '').replace(/\/+$/, '');
  if (!stripped) return null;
  if (stripped.startsWith('/')) return { path: stripped, ...range };
  if (PATH_LIKE_RE.test(stripped) && stripped.includes('/')) return { path: stripped, ...range };
  return null;
}
