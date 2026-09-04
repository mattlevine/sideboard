/**
 * Workspace-local scratch (Conductor-style `.context/`), not committed.
 * Repo-owned Sideboard config stays under `.sideboard/` (settings) and
 * `.claude/skills/` (review + process guides).
 */

/** Preferred local attachments root (plan, drops, review seed). */
export const ATTACHMENTS_DIR = '.context/attachments';

/** Pre-migration Sideboard scratch root — still read for compatibility. */
export const LEGACY_ATTACHMENTS_DIR = '.sideboard/attachments';

const ATTACHMENTS_GITIGNORE = `# Sideboard / workspace attachments (local only)
*
!.gitignore
`;

export function attachmentsGitignoreBody(): string {
  return ATTACHMENTS_GITIGNORE;
}

/** True when a git status path is local scratch and should not count as dirty. */
export function isWorkspaceScratchPath(relativePath: string): boolean {
  const p = relativePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');
  return (
    p === ATTACHMENTS_DIR ||
    p.startsWith(`${ATTACHMENTS_DIR}/`) ||
    p === LEGACY_ATTACHMENTS_DIR ||
    p.startsWith(`${LEGACY_ATTACHMENTS_DIR}/`) ||
    p === '.sideboard' ||
    p.startsWith('.sideboard/') ||
    p === '.context' ||
    p.startsWith('.context/')
  );
}
