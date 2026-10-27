/**
 * A checkout's git host is its `origin` remote. Registered projects on one
 * Mac do not share a host: one repo can be GitHub while another is Cursor
 * or Entire.
 */
export type GitForge = 'github' | 'cursor' | 'entire' | 'other';

export type RemoteRepo = {
  forge: GitForge;
  host: string;
  slug: string;
};

/** Inventory tag: `github:owner/repo`, `cursor:owner/repo`, or `host:owner/repo`. */
export function formatRemoteTag(remote: RemoteRepo): string {
  const name = remote.forge === 'other' ? remote.host : remote.forge;
  return `${name}:${remote.slug}`;
}

function forgeForHost(host: string): GitForge {
  const h = host.toLowerCase();
  if (h === 'github.com' || h.startsWith('github.com-')) return 'github';
  if (h === 'origin.cursor.com') return 'cursor';
  if (
    h === 'entire.io' ||
    h.endsWith('.entire.io') ||
    h === 'entire.com' ||
    h.endsWith('.entire.com')
  ) {
    return 'entire';
  }
  return 'other';
}

function repoFromParts(host: string, owner: string, name: string): RemoteRepo | null {
  if (!host || !owner || !name || owner.includes('@')) return null;
  const normalized = host.toLowerCase();
  return {
    forge: forgeForHost(normalized),
    host: normalized,
    slug: `${owner}/${name}`,
  };
}

/**
 * `owner/name` plus the forge from a git remote URL.
 * SSH aliases such as `github.com-work` stay GitHub. Any other host stays
 * its own forge so it is not labeled GitHub.
 */
export function parseRemoteRepo(url: string): RemoteRepo | null {
  const trimmed = url.trim().replace(/\.git$/i, '');
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith('entire://')) {
    const parts = trimmed
      .slice('entire://'.length)
      .replace(/^\/+/, '')
      .split('/')
      .filter(Boolean);
    if (parts.length === 2) return { forge: 'entire', host: 'entire.io', slug: `${parts[0]}/${parts[1]}` };
    if (parts.length >= 3) {
      return repoFromParts(parts[0], parts[1], parts[2]);
    }
    return null;
  }

  const ssh = trimmed.match(/^git@([^:]+):([^/]+)\/([^/]+)$/i);
  if (ssh?.[1] && ssh[2] && ssh[3]) return repoFromParts(ssh[1], ssh[2], ssh[3]);

  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return repoFromParts(parsed.hostname, parts[parts.length - 2], parts[parts.length - 1]);
  } catch {
    return null;
  }
}
