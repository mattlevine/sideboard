export interface FilePathLink {
  path: string;
  startLine?: number;
  endLine?: number;
}

const CITATION_RE = /^(\d+):(\d+):(.+)$/;

/** Match repo-relative paths like `apps/desktop/src/App.tsx`. */
const PATH_LIKE_RE =
  /^(?:[\w@.-]+\/)+[\w.-]+\.[A-Za-z0-9]+(?:#L\d+(?:-\d+)?)?$|^(?:[\w@.-]+\/)+[\w.-]+$/;

function resolveKnownPath(text: string, knownPaths?: string[]): string | null {
  if (!knownPaths?.length) return null;
  if (knownPaths.includes(text)) return text;
  const suffix = knownPaths.find((p) => p.endsWith(`/${text}`) || p === text);
  return suffix ?? null;
}

/** Parse inline code or citation labels into a worktree-relative file path. */
export function parseFilePathLink(text: string, knownPaths?: string[]): FilePathLink | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const citation = CITATION_RE.exec(trimmed);
  if (citation) {
    const startLine = Number(citation[1]);
    const endLine = Number(citation[2]);
    const path = citation[3]!.trim();
    if (!path) return null;
    return { path, startLine, endLine };
  }

  const known = resolveKnownPath(trimmed, knownPaths);
  if (known) return { path: known };

  if (PATH_LIKE_RE.test(trimmed) && trimmed.includes('/')) {
    return { path: trimmed.replace(/#L\d+(?:-\d+)?$/, '') };
  }

  return null;
}
