/**
 * Hostname of a git remote URL. SCP (`git@host:path`), `ssh://`, and `https://`.
 * SSH aliases such as `github.com-work` stay intact.
 */
export function remoteHostname(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
  const scp = trimmed.match(/^(?:[^@\s]+@)?([^:/\s]+):/);
  return (scp?.[1] ?? '').toLowerCase();
}

/** GitHub.com, its subdomains, and SSH host aliases (`github.com-work`). */
export function remoteIsGitHub(url: string): boolean {
  const host = remoteHostname(url);
  if (!host) return false;
  if (host === 'github.com' || host.endsWith('.github.com')) return true;
  return host.startsWith('github.com-');
}
