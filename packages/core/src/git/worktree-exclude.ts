import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { git } from './run.js';

/** Worktree-local ignore — agents must not commit Sideboard scratch. */
export const WORKTREE_SIDEBOARD_EXCLUDE = '.sideboard/';
export const WORKTREE_CONTEXT_EXCLUDE = '.context/';

const EXCLUDE_COMMENT = '# Sideboard worktree scratch — do not commit';

function excludeHasLine(body: string, ...needles: string[]): boolean {
  return body.split(/\r?\n/).some((line) => needles.includes(line.trim()));
}

/**
 * Ignore `.sideboard/` and `.context/` in this worktree only (`$GIT_DIR/info/exclude`)
 * and skip-worktree any already-tracked files under `.sideboard/` so `git add -A`
 * cannot stage settings.toml / review.md or detached-job logs.
 */
export async function ensureWorktreeSideboardIgnored(
  worktreePath: string,
): Promise<void> {
  if (!worktreePath.trim()) return;
  const gitDir = await git(['rev-parse', '--absolute-git-dir'], worktreePath, {
    reject: false,
    timeoutMs: 5_000,
  });
  if (gitDir.exitCode !== 0) return;
  const dir = gitDir.stdout.trim();
  if (!dir) return;

  const excludePath = join(dir, 'info', 'exclude');
  mkdirSync(dirname(excludePath), { recursive: true });
  let body = '';
  try {
    body = readFileSync(excludePath, 'utf8');
  } catch {
    body = '';
  }
  const missing: string[] = [];
  if (
    !excludeHasLine(body, '.sideboard/', '.sideboard', '/.sideboard/')
  ) {
    missing.push(WORKTREE_SIDEBOARD_EXCLUDE);
  }
  if (!excludeHasLine(body, '.context/', '.context', '/.context/')) {
    missing.push(WORKTREE_CONTEXT_EXCLUDE);
  }
  if (missing.length > 0) {
    const prefix = body && !body.endsWith('\n') ? `${body}\n` : body;
    const header = body.includes(EXCLUDE_COMMENT) ? '' : `${EXCLUDE_COMMENT}\n`;
    writeFileSync(excludePath, `${prefix}${header}${missing.join('\n')}\n`, 'utf8');
  }

  const listed = await git(['ls-files', '-z', '--', '.sideboard'], worktreePath, {
    reject: false,
    timeoutMs: 5_000,
  });
  if (listed.exitCode !== 0 || !listed.stdout) return;
  const files = listed.stdout.split('\0').filter(Boolean);
  if (files.length === 0) return;
  await git(['update-index', '--skip-worktree', '--', ...files], worktreePath, {
    reject: false,
    timeoutMs: 8_000,
  });
}
