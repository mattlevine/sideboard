import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { git } from './run.js';

/** Worktree-local ignore — agents must not commit Sideboard scratch. */
export const WORKTREE_SIDEBOARD_EXCLUDE = '.sideboard/';

const EXCLUDE_COMMENT = '# Sideboard worktree scratch — do not commit';

function excludeHasSideboard(body: string): boolean {
  return body.split(/\r?\n/).some((line) => {
    const t = line.trim();
    return t === '.sideboard/' || t === '.sideboard' || t === '/.sideboard/';
  });
}

/**
 * Ignore `.sideboard/` in this worktree only (`$GIT_DIR/info/exclude`) and
 * skip-worktree any already-tracked files there so `git add -A` cannot stage
 * settings.toml / review.md / detached-jobs.
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
  if (!excludeHasSideboard(body)) {
    const prefix = body && !body.endsWith('\n') ? `${body}\n` : body;
    writeFileSync(
      excludePath,
      `${prefix}${EXCLUDE_COMMENT}\n${WORKTREE_SIDEBOARD_EXCLUDE}\n`,
      'utf8',
    );
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
