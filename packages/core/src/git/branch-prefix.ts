/**
 * Account git branch prefix (Settings → Git).
 * Empty setting falls back to the connected GitHub username.
 */

export function sanitizeGitBranchPrefix(raw: string | null | undefined): string | null {
  const first = (raw ?? '').trim().replace(/^\/+|\/+$/g, '').split('/')[0] ?? '';
  const slug = first
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 39);
  return slug || null;
}

/** Prefer the saved setting; otherwise the GitHub login. */
export function resolveGitBranchPrefix(opts: {
  setting?: string | null;
  githubLogin?: string | null;
}): string | null {
  return (
    sanitizeGitBranchPrefix(opts.setting) ?? sanitizeGitBranchPrefix(opts.githubLogin)
  );
}

/** Example branch for the rename-placeholder directive. */
export function examplePrefixedBranch(
  prefix: string | null | undefined,
  ticket?: string | null,
): string {
  const head = sanitizeGitBranchPrefix(prefix);
  const slug = ticket?.trim()
    ? `${ticket.trim()}-eng-fix-thing`
    : 'bb-1234-eng-fix-thing';
  return head ? `${head}/${slug}` : slug;
}
