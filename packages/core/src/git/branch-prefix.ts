/**
 * Account git branch prefix (Settings → Git).
 * Empty / omitted means no prefix — do not invent a default.
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

/** Saved setting only. Empty does not fall back to the GitHub username. */
export function resolveGitBranchPrefix(opts: {
  setting?: string | null;
}): string | null {
  return sanitizeGitBranchPrefix(opts.setting);
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
