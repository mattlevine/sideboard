export interface FilePathLink {
  path: string;
  startLine?: number;
  endLine?: number;
}

const CITATION_RE = /^(\d+):(\d+):(.+)$/;

/** Match repo-relative or absolute POSIX paths like `apps/desktop/src/App.tsx`. */
const PATH_LIKE_RE =
  /^(?:\/)?(?:[\w@.-]+\/)+[\w.-]+\.[A-Za-z0-9]+(?:#L\d+(?:-\d+)?)?$|^(?:\/)?(?:[\w@.-]+\/)+[\w.-]+$/;

function resolveKnownPath(text: string, knownPaths?: string[]): string | null {
  if (!knownPaths?.length) return null;
  if (knownPaths.includes(text)) return text;
  const suffix = knownPaths.find((p) => p.endsWith(`/${text}`) || p === text);
  return suffix ?? null;
}

/** Map an absolute worktree path to a relative path; reject escapes. */
export function toWorktreeRelativePath(
  path: string,
  worktreePath?: string,
): string | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes('..')) return null;
  if (!trimmed.startsWith('/')) return trimmed;
  if (!worktreePath) return null;
  const wt = worktreePath.replace(/\/+$/, '');
  if (trimmed === wt) return '.';
  const prefix = `${wt}/`;
  if (!trimmed.startsWith(prefix)) return null;
  const rel = trimmed.slice(prefix.length);
  if (!rel) return '.';
  if (rel.includes('..')) return null;
  return rel;
}

export function isKnownDirectoryPath(path: string, knownPaths?: string[]): boolean {
  if (!knownPaths?.length || !path || path === '.') return false;
  const prefix = path.endsWith('/') ? path : `${path}/`;
  return knownPaths.some((p) => p.startsWith(prefix));
}

function lineRangeFromHash(text: string): { startLine?: number; endLine?: number } {
  const match = /#L(\d+)(?:-(\d+))?$/.exec(text);
  if (!match) return {};
  return {
    startLine: Number(match[1]),
    endLine: match[2] ? Number(match[2]) : undefined,
  };
}

function finalizeLink(
  path: string,
  worktreePath: string | undefined,
  range: { startLine?: number; endLine?: number },
): FilePathLink | null {
  const rel = toWorktreeRelativePath(path, worktreePath);
  if (rel == null) return path.startsWith('/') ? null : { path, ...range };
  return { path: rel, ...range };
}

/** Parse inline code or citation labels into a worktree-relative file path. */
export function parseFilePathLink(
  text: string,
  knownPaths?: string[],
  worktreePath?: string,
): FilePathLink | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const citation = CITATION_RE.exec(trimmed);
  if (citation) {
    const startLine = Number(citation[1]);
    const endLine = Number(citation[2]);
    const path = citation[3]!.trim();
    if (!path) return null;
    return finalizeLink(path, worktreePath, { startLine, endLine });
  }

  const range = lineRangeFromHash(trimmed);
  const stripped = trimmed.replace(/#L\d+(?:-\d+)?$/, '').replace(/\/+$/, '');
  if (!stripped) return null;

  const known = resolveKnownPath(stripped, knownPaths);
  if (known) return { path: known, ...range };

  // `apps` / `packages` — single segment, but a tracked file lives under it.
  if (isKnownDirectoryPath(stripped, knownPaths)) {
    return { path: stripped, ...range };
  }

  if (PATH_LIKE_RE.test(stripped) && stripped.includes('/')) {
    return finalizeLink(stripped, worktreePath, range);
  }

  if (worktreePath && stripped.startsWith('/')) {
    return finalizeLink(stripped, worktreePath, range);
  }

  return null;
}
