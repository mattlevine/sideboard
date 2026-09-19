import {
  isKnownDirectoryPath,
  toWorktreeRelativePath,
  type FilePathLink,
} from './file-path-link';

/** Open a file in the editor, or focus a folder in the right-sidebar file tree. */
export async function openWorktreePathLink(opts: {
  link: FilePathLink;
  threadId?: string;
  worktreePath?: string;
  knownFilePaths?: string[];
  onOpenFile?: (path: string) => void;
  onRevealDirectory?: (path: string) => void;
}): Promise<void> {
  const { link, threadId, worktreePath, knownFilePaths, onOpenFile, onRevealDirectory } =
    opts;
  const rel =
    toWorktreeRelativePath(link.path, worktreePath) ??
    (link.path.startsWith('/') ? null : link.path);
  if (!rel) return;
  if (rel === '.') {
    onRevealDirectory?.('.');
    return;
  }
  if (!threadId) return;
  let kind: 'file' | 'dir' | 'missing' = 'missing';
  try {
    kind = await window.sideboard.statPath(threadId, rel);
  } catch {
    if (isKnownDirectoryPath(rel, knownFilePaths)) onRevealDirectory?.(rel);
    return;
  }
  if (kind === 'file') {
    onOpenFile?.(rel);
    return;
  }
  if (kind === 'dir' || isKnownDirectoryPath(rel, knownFilePaths)) {
    onRevealDirectory?.(rel);
  }
}
