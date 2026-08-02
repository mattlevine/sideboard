import { git } from '../git/run.js';

const GENERIC_TITLE_RE =
  /^(sideboard:|thread\/|wip\b|tmp\b|update\b|changes?\b|misc\b|stuff\b)/i;

function looksGeneric(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (t.length < 4) return true;
  if (GENERIC_TITLE_RE.test(t)) return true;
  // Soccer-team / single proper-noun nicknames used as Sideboard thread labels
  if (!/[\s:/\-_]/.test(t) && t.length <= 24) return true;
  return false;
}

function truncateTitle(title: string, max = 72): string {
  const t = title.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function titleFromPaths(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const top = paths.slice(0, 3).map((p) => p.replace(/\/$/, ''));
  if (paths.length === 1) return truncateTitle(`Update ${top[0]}`);
  if (paths.length <= 3) return truncateTitle(`Update ${top.join(', ')}`);
  return truncateTitle(`Update ${top[0]} and ${paths.length - 1} more files`);
}

/**
 * Build a PR title/body from what actually changed on the branch (commits + files),
 * not the Sideboard thread nickname.
 */
export async function suggestPrMetadata(
  worktreePath: string,
  opts: { base: string; fallbackTitle?: string | null; sourceLabel?: string },
): Promise<{ title: string; body: string; commitMessage: string }> {
  const [{ stdout: logOut }, { stdout: nameStatus }, { stdout: statOut }] =
    await Promise.all([
      git(['log', '--format=%s', `${opts.base}..HEAD`], worktreePath, {
        reject: false,
      }),
      git(['diff', '--name-only', `${opts.base}...HEAD`], worktreePath, {
        reject: false,
      }),
      git(['diff', '--stat', `${opts.base}...HEAD`], worktreePath, {
        reject: false,
      }),
    ]);

  // Also include dirty working-tree paths so uncommitted land still names well.
  const { stdout: dirtyNames } = await git(['diff', '--name-only', 'HEAD'], worktreePath, {
    reject: false,
  });
  const { stdout: untracked } = await git(
    ['ls-files', '--others', '--exclude-standard'],
    worktreePath,
    { reject: false },
  );

  const subjects = logOut
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const paths = [
    ...new Set(
      [...nameStatus.split('\n'), ...dirtyNames.split('\n'), ...untracked.split('\n')]
        .map((p) => p.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const meaningfulSubjects = subjects.filter((s) => !looksGeneric(s));
  const fallback = opts.fallbackTitle?.trim() || null;
  const fallbackOk = fallback && !looksGeneric(fallback) ? fallback : null;

  const title = truncateTitle(
    meaningfulSubjects[0] ??
      fallbackOk ??
      titleFromPaths(paths) ??
      'Sideboard changes',
  );

  const commitMessage =
    meaningfulSubjects[0] ??
    fallbackOk ??
    titleFromPaths(paths) ??
    `sideboard: ${title}`;

  const summaryLines =
    meaningfulSubjects.length > 0
      ? meaningfulSubjects.slice(0, 12).map((s) => `- ${s}`)
      : paths.slice(0, 20).map((p) => `- \`${p}\``);

  const bodyParts = [
    '## Summary',
    summaryLines.length > 0
      ? summaryLines.join('\n')
      : '- Changes landed via Sideboard.',
    '',
  ];
  if (statOut.trim()) {
    bodyParts.push('## Diff', '```', statOut.trim(), '```', '');
  }
  if (opts.sourceLabel) {
    bodyParts.push(`_Landed via Sideboard from ${opts.sourceLabel}_`);
  }

  return {
    title,
    body: bodyParts.join('\n').trim() + '\n',
    commitMessage: truncateTitle(commitMessage, 72),
  };
}
