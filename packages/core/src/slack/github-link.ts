export type GithubLinkKind = 'pr' | 'code' | 'comment' | 'other';

export interface GithubLinkLabel {
  kind: GithubLinkKind;
  /** Short human label for Slack mrkdwn, e.g. "PR #42" or "foo.ts:12". */
  label: string;
  url: string;
}

/**
 * Classify a GitHub URL for Slack notify messages.
 * Recognizes PRs, blob permalinks with line anchors, and review/issue comments.
 */
export function labelGithubUrl(url: string): GithubLinkLabel | null {
  const raw = url.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return null;

  const path = parsed.pathname;
  const hash = parsed.hash || '';

  const pr = path.match(/\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (pr) {
    const n = pr[3]!;
    if (/#discussion_r\d+/i.test(hash) || /#pullrequestreview-\d+/i.test(hash)) {
      return { kind: 'comment', label: `PR #${n} comment`, url: raw };
    }
    if (/#issuecomment-\d+/i.test(hash)) {
      return { kind: 'comment', label: `PR #${n} comment`, url: raw };
    }
    return { kind: 'pr', label: `PR #${n}`, url: raw };
  }

  const issueComment = path.match(/\/([^/]+)\/([^/]+)\/issues\/(\d+)/i);
  if (issueComment && /#issuecomment-\d+/i.test(hash)) {
    return { kind: 'comment', label: `Issue #${issueComment[3]} comment`, url: raw };
  }

  const blob = path.match(/\/([^/]+)\/([^/]+)\/blob\/[^/]+\/(.+)$/i);
  if (blob) {
    const filePath = decodeURIComponent(blob[3]!);
    const fileName = filePath.split('/').pop() || filePath;
    const line = hash.match(/^#L(\d+)(?:-L(\d+))?$/i);
    if (line) {
      const start = line[1]!;
      const end = line[2];
      const loc = end && end !== start ? `${start}-${end}` : start;
      return { kind: 'code', label: `${fileName}:${loc}`, url: raw };
    }
    return { kind: 'code', label: fileName, url: raw };
  }

  return { kind: 'other', label: 'GitHub', url: raw };
}

/** Append a Slack mrkdwn link for a GitHub URL onto a message body. */
export function appendGithubLink(text: string, githubUrl: string | undefined): string {
  const body = text.trimEnd();
  if (!githubUrl?.trim()) return body;
  const labeled = labelGithubUrl(githubUrl);
  if (!labeled) {
    return body ? `${body}\n${githubUrl.trim()}` : githubUrl.trim();
  }
  const link = `<${labeled.url}|${labeled.label}>`;
  return body ? `${body}\n${link}` : link;
}
